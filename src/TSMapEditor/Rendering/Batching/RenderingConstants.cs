namespace TSMapEditor.Rendering.Batching
{
    class RenderingConstants
    {
#if WINDOWS
        public const int MaximumDX11TextureSize = 16384;
#else
        // WebGL / KNI HiDef profile caps Texture2D at 4096; sprite-sheet atlases must fit within it.
        public const int MaximumDX11TextureSize = 4096;
#endif
        public const int MaxVertices = 65535;
        public const int VerticesPerQuad = 4;
        public const int IndexesPerQuad = 6;
        public const int TrianglesPerQuad = 2;
    }
}
