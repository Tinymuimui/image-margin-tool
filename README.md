# Print Margin Extender

Browser-only React/TypeScript utility for preparing JPEG/PNG images for print.

## Behavior

- Target size is specified in millimeters and DPI.
- If the source already fits inside the target pixel dimensions, it stays at 1:1 pixel size.
- If the source exceeds the target width or height, it is automatically scaled down with aspect ratio preserved so it fits entirely inside the target.
- No cropping or upscaling is performed.
- Remaining space can use:
  - blurred extension of the source image
  - custom JPEG/PNG background image
  - edge stretch
  - solid color
- Custom background controls:
  - blur amount in mm
  - fit mode: cover / contain / stretch
  - opacity
  - brightness
- The custom background is shared by all foreground images in the current batch.
- The foreground is always drawn after the background, so background blur does not blur the foreground.
- PNG and JPEG DPI metadata is explicitly written after Canvas encoding.
- Multiple files are processed sequentially and exported as one ZIP.
- All image processing is local in the browser; images are not uploaded to an API/server.

## Oversized-image behavior

An oversized source uses:

```text
scale = min(1, targetWidth / sourceWidth, targetHeight / sourceHeight)
```

This keeps the aspect ratio, avoids cropping, and ensures offsets never become negative. The preview path first reduces an oversized foreground to the fitted preview size to avoid unnecessarily large preview canvases.

## Custom background in v1.2.0

Choose **カスタム背景画像** in the margin mode and select one JPEG/PNG background. The background is rendered before the foreground and can be adjusted independently:

- **BGぼかし量 (mm)**: 0-20 mm
- **BG配置**:
  - Cover: fills the full target while preserving aspect ratio; excess may be cropped
  - Contain: shows the whole background while preserving aspect ratio; underlay color may remain visible
  - Stretch: fills the target exactly; aspect ratio may change
- **BG不透明度**: 0-100%
- **BG明るさ**: 0-300%
- **下地色** is visible behind a transparent/contained custom background.

## Print caveats

- Browser Canvas does not guarantee preservation of CMYK or ICC profiles.
- For commercial print workflows requiring color management, verify the generated files in a color-managed application before submission.
- Print at 100% / actual size. Printer-driver scaling changes the physical dimensions.

## Development

Requires Node.js 20.19+ or 22.12+; Node.js 22 is recommended.

```bash
npm install
npm run check
npm run build
npm run dev
```

## GitHub Pages

1. Upload the project contents to the repository root, including `.github/workflows/deploy.yml`.
2. In GitHub: **Settings -> Pages -> Build and deployment -> Source -> GitHub Actions**.
3. Push/commit to `main`.
4. The workflow runs type/self checks, builds Vite, uploads `dist`, and deploys Pages.

`vite.config.ts` uses `base: './'`, so this single-page static app works under a project Pages subpath without hardcoding the repository name.
