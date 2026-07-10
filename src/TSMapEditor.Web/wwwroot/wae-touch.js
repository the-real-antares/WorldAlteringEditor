// Touch-input bridge for WAE in the browser, so the editor is usable on tablets without a mouse.
//
// KNI's Blazor platform reads mouse and wheel events from the window but has no real touch
// handling, so this translates touch gestures into the synthetic mouse/wheel events the platform
// already understands. Nothing in XNAUI or KNI has to change.
//
//   one finger            -> left mouse button (select / paint / place)
//   two-finger tap        -> right click (cancel current tool / deselect)
//   two-finger drag       -> right button held + move = WAE's map panning
//   pinch                 -> mouse wheel = zoom
//
// Desktop mouse users are unaffected: touch events simply never fire for them, and the bridge
// only installs itself when the device reports touch support.
(function () {
  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0))
    return; // no touch device - leave mouse handling entirely to the platform

  // Tuning. Kept obvious so behaviour can be adjusted from device testing.
  var LEFT_PRESS_DELAY_MS = 70;    // hold-off before committing a left press, so a second finger
                                   // arriving turns the gesture into a pan/zoom, not a stray click
  var PINCH_PIXELS_PER_TICK = 60;  // change in finger distance that equals one zoom step
  var ZOOM_WHEEL_DELTA = 120;      // synthetic wheel delta per zoom step
  var ZOOM_IN_ON_SPREAD = true;    // fingers moving apart zooms in (flip if it feels inverted)
  var MOVE_EPSILON = 0.5;          // px of movement below which a frame is treated as still

  var canvas = null;
  var mode = 'idle';               // idle | pendingLeft | left | multi | ignoreRest
  var leftTimer = 0;
  var leftPos = { x: 0, y: 0 };
  var lastMidX = 0, lastMidY = 0, lastDist = 0, pinchAccum = 0;

  function getCanvas() { return canvas || (canvas = document.getElementById('theCanvas')); }

  function dispatchMouse(type, x, y, button, buttons) {
    var target = getCanvas() || window;
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: button, buttons: buttons
    }));
  }

  function dispatchWheel(deltaY, x, y) {
    var target = getCanvas() || window;
    target.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, deltaY: deltaY, deltaMode: 0
    }));
  }

  function touchPoints(ev) {
    var arr = [];
    for (var i = 0; i < ev.touches.length; i++)
      arr.push({ x: ev.touches[i].clientX, y: ev.touches[i].clientY });
    return arr;
  }

  function midpoint(list) {
    var x = 0, y = 0;
    for (var i = 0; i < list.length; i++) { x += list[i].x; y += list[i].y; }
    return { x: x / list.length, y: y / list.length };
  }

  function distance(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function cancelPendingLeft() {
    if (leftTimer) { clearTimeout(leftTimer); leftTimer = 0; }
  }

  function beginMulti(list) {
    var mid = midpoint(list);
    mode = 'multi';
    lastMidX = mid.x; lastMidY = mid.y;
    lastDist = distance(list[0], list[1]);
    pinchAccum = 0;
    // Press the right button at the midpoint. A release without movement becomes a right
    // click (deselect); movement pans the map via WAE's right-click scrolling.
    dispatchMouse('mousemove', mid.x, mid.y, 2, 0);
    dispatchMouse('mousedown', mid.x, mid.y, 2, 2);
  }

  function onTouchStart(ev) {
    ev.preventDefault();
    var list = touchPoints(ev);

    if (list.length === 1) {
      leftPos = { x: list[0].x, y: list[0].y };
      mode = 'pendingLeft';
      cancelPendingLeft();
      leftTimer = setTimeout(function () {
        leftTimer = 0;
        if (mode === 'pendingLeft') {
          mode = 'left';
          dispatchMouse('mousemove', leftPos.x, leftPos.y, 0, 0);
          dispatchMouse('mousedown', leftPos.x, leftPos.y, 0, 1);
        }
      }, LEFT_PRESS_DELAY_MS);
    } else if (list.length === 2) {
      cancelPendingLeft();
      if (mode === 'left') {
        // Release a left press already in progress before switching to two-finger mode.
        dispatchMouse('mouseup', leftPos.x, leftPos.y, 0, 0);
      }
      beginMulti(list);
    }
    // 3+ fingers: keep whatever multi state we already have.
  }

  function onTouchMove(ev) {
    ev.preventDefault();
    var list = touchPoints(ev);

    if (mode === 'pendingLeft' && list.length === 1) {
      // Moved before the hold-off elapsed: commit the press now so drags stay responsive.
      cancelPendingLeft();
      leftPos = { x: list[0].x, y: list[0].y };
      mode = 'left';
      dispatchMouse('mousemove', leftPos.x, leftPos.y, 0, 0);
      dispatchMouse('mousedown', leftPos.x, leftPos.y, 0, 1);
      return;
    }

    if (mode === 'left' && list.length === 1) {
      leftPos = { x: list[0].x, y: list[0].y };
      dispatchMouse('mousemove', leftPos.x, leftPos.y, 0, 1);
      return;
    }

    if (mode === 'multi' && list.length >= 2) {
      var mid = midpoint(list);
      var dist = distance(list[0], list[1]);
      var dMid = Math.abs(mid.x - lastMidX) + Math.abs(mid.y - lastMidY);
      var dDist = dist - lastDist;

      if (Math.abs(dDist) > dMid && Math.abs(dDist) > MOVE_EPSILON) {
        // Pinch dominates this frame -> emit zoom steps.
        pinchAccum += dDist;
        while (Math.abs(pinchAccum) >= PINCH_PIXELS_PER_TICK) {
          var spreading = pinchAccum > 0;
          pinchAccum += spreading ? -PINCH_PIXELS_PER_TICK : PINCH_PIXELS_PER_TICK;
          var zoomIn = spreading === ZOOM_IN_ON_SPREAD;
          // Browser convention: negative deltaY is a scroll up, which WAE maps to zoom in.
          dispatchWheel(zoomIn ? -ZOOM_WHEEL_DELTA : ZOOM_WHEEL_DELTA, mid.x, mid.y);
        }
      } else if (dMid > MOVE_EPSILON) {
        // Otherwise pan by dragging with the right button held.
        dispatchMouse('mousemove', mid.x, mid.y, 2, 2);
      }

      lastMidX = mid.x; lastMidY = mid.y; lastDist = dist;
      return;
    }
  }

  function onTouchEnd(ev) {
    ev.preventDefault();
    var remaining = touchPoints(ev); // touches still on screen (the lifted one is gone)

    if (mode === 'multi') {
      if (remaining.length <= 1) {
        // Release the right button. Without movement this is a right click (deselect); with
        // movement the pan simply ends. Ignore any leftover finger so lifting the second
        // finger doesn't immediately start a fresh left action.
        dispatchMouse('mouseup', lastMidX, lastMidY, 2, 0);
        mode = remaining.length === 1 ? 'ignoreRest' : 'idle';
      }
      return;
    }

    if (mode === 'ignoreRest') {
      if (remaining.length === 0) mode = 'idle';
      return;
    }

    if ((mode === 'left' || mode === 'pendingLeft') && remaining.length === 0) {
      cancelPendingLeft();
      if (mode === 'pendingLeft') {
        // A tap that ended before the hold-off elapsed: emit the whole click now.
        dispatchMouse('mousemove', leftPos.x, leftPos.y, 0, 0);
        dispatchMouse('mousedown', leftPos.x, leftPos.y, 0, 1);
      }
      dispatchMouse('mouseup', leftPos.x, leftPos.y, 0, 0);
      mode = 'idle';
    }
  }

  function attach() {
    var c = getCanvas();
    if (!c) { setTimeout(attach, 200); return; } // canvas is created once the platform starts

    var opts = { passive: false };
    c.addEventListener('touchstart', onTouchStart, opts);
    c.addEventListener('touchmove', onTouchMove, opts);
    c.addEventListener('touchend', onTouchEnd, opts);
    c.addEventListener('touchcancel', onTouchEnd, opts);
    c.style.touchAction = 'none'; // stop the browser's own pan/zoom on the canvas
    console.log('WAE: touch input bridge attached');
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', attach);
  else
    attach();
})();
