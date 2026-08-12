# Print Margin Extender

複数の JPEG / PNG に対して、元画像をリサイズせず、指定した **mm × DPI** の仕上がりサイズまで余白を追加するブラウザ内ツールです。

## 主な仕様

- 複数画像のドラッグ＆ドロップ
- 仕上がり幅・高さを mm 指定
- DPI 指定（初期値 300 dpi）
- 元画像は 1:1 のまま中央配置し、拡大・縮小・トリミングしない
- 余白モード
  - ぼかし拡張（推奨）
  - 端を引き伸ばす
  - 単色
- PNG / JPEG の DPI メタデータを明示的に設定
  - PNG: `pHYs`
  - JPEG: JFIF density + EXIF X/YResolution/ResolutionUnit
- 複数画像を ZIP で一括保存
- 画像処理はすべてブラウザ内で実行。サーバーへのアップロードなし
- GitHub Pages 対応

## 重要な前提

このアプリでは **元画像も指定した DPI で扱う** ため、元画像の実寸は次式で計算します。

```text
実寸(mm) = ピクセル数 / DPI × 25.4
```

例えば 900 × 1200 px を 300 dpi で扱う場合、約 76.2 × 101.6 mm です。

指定した仕上がりピクセルより元画像が大きい場合は、元画像を縮小しない仕様のためエラーにします。

## 印刷に関する注意

- ブラウザ Canvas は CMYK / ICC カラープロファイルの保持を保証しません。
- 色校正が必要な商業印刷・入稿では、生成後に Photoshop 等のカラーマネジメント対応ソフトで最終確認してください。
- DPI メタデータを埋め込んでも、印刷ダイアログ側で自動拡大・縮小すると寸法は変わります。印刷時は「実際のサイズ」「100%」を選んでください。
- 「ぼかし拡張」は生成AIではありません。複雑な人物、文字、規則模様を自然に描き足す用途では AI アウトペインティングの方が適しています。

## 開発環境

Vite 8 の要件（Node.js 20.19+ / 22.12+）に合わせ、Node.js 22 を推奨します。

```bash
npm install
npm run dev
```

型チェック + セルフチェック:

```bash
npm run check
```

本番ビルド:

```bash
npm run build
npm run preview
```

## GitHub Pages への公開

1. このプロジェクトを GitHub リポジトリへ push します。
2. GitHub の **Settings → Pages** を開きます。
3. **Build and deployment → Source** を **GitHub Actions** にします。
4. `main` ブランチへ push すると `.github/workflows/deploy.yml` が自動ビルド・公開します。

`vite.config.ts` は `base: './'` にしてあるため、ユーザー/組織 Pages とプロジェクト Pages のどちらでも静的アセットを相対参照できます。このアプリは SPA ルーティングを使っていません。

## リポジトリ作成例

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<YOUR_NAME>/image-margin-tool.git
git push -u origin main
```

## 出力方式

- 出力ファイル名: `001_original_margin_100x150mm_300dpi.jpg` の形式
- 複数画像は `print-margin_100x150mm_300dpi.zip` として保存
- JPEG は既定で品質 0.95
- ZIP 内の画像はすでに PNG/JPEG 圧縮済みのため、ZIP 側は `STORE` を使用して不要な再圧縮を避けています

## セキュリティ/プライバシー

画像データを外部 API に送信する処理はありません。GitHub Pages から配信される JavaScript が、ユーザーのブラウザ内で File API / Canvas API を使用して処理します。
