#pragma enable_d3d11_debug_symbols

#if OPENGL
#define SV_POSITION POSITION
#define VS_SHADERMODEL vs_3_0
#define PS_SHADERMODEL ps_3_0
#else
#define VS_SHADERMODEL vs_4_0
#define PS_SHADERMODEL ps_4_0
#endif

// A single-channel Alpha8 texture stores its value in .a on Direct3D but in .r on OpenGL/WebGL,
// where the backend represents it as a luminance texture (value replicated into rgb, alpha 1.0).
#if OPENGL
#define ALPHA8(tex) ((tex).r)
#else
#define ALPHA8(tex) ((tex).a)
#endif

// Shader for rendering Tiberian Sun alpha images to an alpha map.

Texture2D SpriteTexture;
sampler2D SpriteTextureSampler : register(s0)
{
    Texture = <SpriteTexture>; // this is set by spritebatch
    AddressU = clamp;
    AddressV = clamp;
    MipFilter = Point;
    MinFilter = Point;
    MagFilter = Point;
};

struct VertexShaderOutput
{
    float4 Position : SV_POSITION;
    float4 Color : COLOR0;
    float2 TextureCoordinates : TEXCOORD0;
};

float4 MainPS(VertexShaderOutput input) : COLOR
{
    // We need to read from the main texture first,
    // otherwise the output will be black!
    float alphaTex = ALPHA8(tex2D(SpriteTextureSampler, input.TextureCoordinates));
    
    return float4(alphaTex - 0.5, 0, 0, 0.0);
}

technique SpriteDrawing
{
    pass P0
    {
        PixelShader = compile PS_SHADERMODEL MainPS();
    }
};