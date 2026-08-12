import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { embedDpiMetadata } from './lib/dpiMetadata';
import { downloadBlob, isSupportedImage, outputFileName, resolveOutputFormat } from './lib/files';
import { assertCanvasSize, calculatePlacement, canvasToBlob, decodeImage, renderImage, renderPreview } from './lib/image';
import { formatMm, mmToPx, pxToMm } from './lib/math';
import type { ImageItem, Settings } from './types';

const DEFAULT_SETTINGS: Settings = {
  widthMm: 100,
  heightMm: 150,
  dpi: 300,
  mode: 'blur',
  blurMm: 2.5,
  backgroundColor: '#ffffff',
  outputFormat: 'same',
  jpegQuality: 0.95,
};

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const target = useMemo(() => {
    try {
      const widthPx = mmToPx(settings.widthMm, settings.dpi);
      const heightPx = mmToPx(settings.heightMm, settings.dpi);
      assertCanvasSize(widthPx, heightPx);
      return { widthPx, heightPx, error: '' };
    } catch (error) {
      return {
        widthPx: 0,
        heightPx: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [settings.widthMm, settings.heightMm, settings.dpi]);

  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const selectedPlacement = useMemo(() => {
    if (!selectedItem || target.error || target.widthPx <= 0 || target.heightPx <= 0) return null;
    return calculatePlacement(selectedItem.widthPx, selectedItem.heightPx, target.widthPx, target.heightPx);
  }, [selectedItem, target.error, target.widthPx, target.heightPx]);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files).filter(isSupportedImage);
    if (candidates.length === 0) {
      setMessage('JPEG または PNG を選択してください。');
      return;
    }

    setBusy(true);
    setMessage('画像情報を読み込んでいます…');
    const loaded: ImageItem[] = [];
    const failures: string[] = [];

    for (const file of candidates) {
      try {
        const decoded = await decodeImage(file);
        loaded.push({
          id: `${crypto.randomUUID()}-${file.name}`,
          file,
          widthPx: decoded.width,
          heightPx: decoded.height,
        });
        decoded.close();
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    setItems((current) => [...current, ...loaded]);
    if (loaded.length > 0) setSelectedId((current) => current ?? loaded[0]?.id ?? null);
    setMessage(
      failures.length > 0
        ? `${loaded.length}件を追加しました。${failures.length}件は読み込めませんでした。`
        : `${loaded.length}件を追加しました。`,
    );
    setBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let localUrl: string | null = null;

    const run = async () => {
      if (!selectedItem || target.error || target.widthPx === 0 || target.heightPx === 0) {
        setPreviewUrl(null);
        setPreviewError('');
        return;
      }
      setPreviewError('');
      setPreviewUrl(null);

      try {
        const decoded = await decodeImage(selectedItem.file);
        try {
          if (cancelled) return;
          const blurPx = mmToPx(Math.max(0.01, settings.blurMm), settings.dpi);
          const preview = renderPreview(decoded.source, decoded.width, decoded.height, {
            targetWidth: target.widthPx,
            targetHeight: target.heightPx,
            mode: settings.mode,
            blurPx: settings.mode === 'blur' ? blurPx : 0,
            backgroundColor: settings.backgroundColor,
          });
          const blob = await canvasToBlob(preview, 'jpeg', 0.88);
          preview.width = 1;
          preview.height = 1;
          if (cancelled) return;
          localUrl = URL.createObjectURL(blob);
          setPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return localUrl;
          });
        } finally {
          decoded.close();
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [selectedItem, target.error, target.widthPx, target.heightPx, settings.mode, settings.blurMm, settings.dpi, settings.backgroundColor]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const processAll = async () => {
    if (items.length === 0) {
      setMessage('画像を追加してください。');
      return;
    }
    if (target.error) {
      setMessage(target.error);
      return;
    }

    setBusy(true);
    setProgress(0);
    setMessage('画像を処理しています…');
    const zip = new JSZip();
    const failures: string[] = [];

    try {
      const blurPx = mmToPx(Math.max(0.01, settings.blurMm), settings.dpi);

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;
        try {
          const decoded = await decodeImage(item.file);
          let canvas: HTMLCanvasElement | null = null;
          try {
            canvas = renderImage(decoded.source, decoded.width, decoded.height, {
              targetWidth: target.widthPx,
              targetHeight: target.heightPx,
              mode: settings.mode,
              blurPx: settings.mode === 'blur' ? blurPx : 0,
              backgroundColor: settings.backgroundColor,
            });
            const format = resolveOutputFormat(item.file, settings.outputFormat);
            const encoded = await canvasToBlob(canvas, format, settings.jpegQuality);
            const withDpi = await embedDpiMetadata(encoded, format, settings.dpi);
            zip.file(
              outputFileName(item.file.name, i, settings.widthMm, settings.heightMm, settings.dpi, format),
              withDpi,
              { binary: true, compression: 'STORE' },
            );
          } finally {
            decoded.close();
            if (canvas) {
              canvas.width = 1;
              canvas.height = 1;
            }
          }
        } catch (error) {
          failures.push(`${item.file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        setProgress(Math.round(((i + 1) / items.length) * 90));
      }

      if (failures.length === items.length) {
        throw new Error(`すべての画像処理に失敗しました。\n${failures.join('\n')}`);
      }

      setMessage('ZIPを作成しています…');
      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE', streamFiles: true },
        (metadata) => setProgress(90 + Math.round(metadata.percent / 10)),
      );
      const zipName = `print-margin_${settings.widthMm}x${settings.heightMm}mm_${settings.dpi}dpi.zip`;
      downloadBlob(zipBlob, zipName);
      setProgress(100);
      setMessage(
        failures.length > 0
          ? `完了しました。${items.length - failures.length}件成功、${failures.length}件失敗。`
          : `${items.length}件を処理してZIPを作成しました。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const clearAll = () => {
    setItems([]);
    setSelectedId(null);
    setMessage('画像一覧をクリアしました。');
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Browser-only print utility</p>
          <h1>Print Margin Extender</h1>
          <p className="lead">元画像は、仕上がりサイズを超える場合だけアスペクト比を維持して自動縮小し、不足分に自然な余白を追加します。画像はサーバーへ送信しません。</p>
        </div>
        <div className="privacy-badge">Local processing</div>
      </header>

      <section className="panel settings-panel">
        <h2>1. 仕上がり設定</h2>
        <div className="form-grid">
          <label>
            <span>横幅 (mm)</span>
            <input type="number" min="0.1" step="0.1" value={settings.widthMm} onChange={(e) => updateSetting('widthMm', Number(e.target.value))} />
          </label>
          <label>
            <span>縦幅 (mm)</span>
            <input type="number" min="0.1" step="0.1" value={settings.heightMm} onChange={(e) => updateSetting('heightMm', Number(e.target.value))} />
          </label>
          <label>
            <span>DPI</span>
            <input type="number" min="1" max="1200" step="1" value={settings.dpi} onChange={(e) => updateSetting('dpi', Number(e.target.value))} />
          </label>
          <label>
            <span>余白生成</span>
            <select value={settings.mode} onChange={(e) => updateSetting('mode', e.target.value as Settings['mode'])}>
              <option value="blur">ぼかし拡張（推奨）</option>
              <option value="edge">端を引き伸ばす</option>
              <option value="solid">単色</option>
            </select>
          </label>
          <label>
            <span>ぼかし量 (mm)</span>
            <input type="number" min="0.1" max="20" step="0.1" disabled={settings.mode !== 'blur'} value={settings.blurMm} onChange={(e) => updateSetting('blurMm', Number(e.target.value))} />
          </label>
          <label>
            <span>下地色</span>
            <div className="color-row">
              <input type="color" value={settings.backgroundColor} onChange={(e) => updateSetting('backgroundColor', e.target.value)} />
              <input type="text" value={settings.backgroundColor} readOnly aria-label="下地色の16進数" />
            </div>
          </label>
          <label>
            <span>出力形式</span>
            <select value={settings.outputFormat} onChange={(e) => updateSetting('outputFormat', e.target.value as Settings['outputFormat'])}>
              <option value="same">元形式を維持</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
          <label>
            <span>JPEG品質</span>
            <input type="number" min="0.5" max="1" step="0.01" value={settings.jpegQuality} onChange={(e) => updateSetting('jpegQuality', Number(e.target.value))} />
          </label>
        </div>

        <div className={`target-summary ${target.error ? 'error' : ''}`}>
          {target.error
            ? target.error
            : `出力ピクセル: ${target.widthPx.toLocaleString()} × ${target.heightPx.toLocaleString()} px / ${settings.dpi} dpi`}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>2. 画像を追加</h2>
            <p>JPEG / PNG。複数選択・ドラッグ＆ドロップ対応。</p>
          </div>
          {items.length > 0 && <button className="ghost-button" type="button" onClick={clearAll} disabled={busy}>すべて削除</button>}
        </div>

        <button
          className="drop-zone"
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
        >
          <strong>ここに画像をドロップ</strong>
          <span>またはクリックしてファイルを選択</span>
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          multiple
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ''; }}
        />

        {items.length > 0 && (
          <div className="workspace">
            <div className="file-list" aria-label="画像一覧">
              {items.map((item) => {
                const placement = target.error ? null : calculatePlacement(item.widthPx, item.heightPx, target.widthPx, target.heightPx);
                const autoScaled = placement?.scaledDown ?? false;
                return (
                  <div key={item.id} className={`file-row ${selectedItem?.id === item.id ? 'selected' : ''}`}>
                    <button className="file-main" type="button" onClick={() => setSelectedId(item.id)}>
                      <span className="file-name">{item.file.name}</span>
                      <span className="file-meta">
                        {item.widthPx.toLocaleString()} × {item.heightPx.toLocaleString()} px
                        {' / '}
                        {formatMm(pxToMm(item.widthPx, settings.dpi))} × {formatMm(pxToMm(item.heightPx, settings.dpi))} mm相当
                      </span>
                      <span className={autoScaled ? 'status-warn' : 'status-good'}>
                        {autoScaled && placement ? `\u81ea\u52d5\u7e2e\u5c0f ${(placement.scale * 100).toFixed(1)}%` : '\u7b49\u500d\u3067\u51e6\u7406'}
                      </span>
                    </button>
                    <button className="remove-button" type="button" aria-label={`${item.file.name} を削除`} onClick={() => removeItem(item.id)}>×</button>
                  </div>
                );
              })}
            </div>

            <div className="preview-card">
              <div className="preview-label">プレビュー</div>
              {previewUrl ? (
                <img src={previewUrl} alt="余白追加後のプレビュー" />
              ) : (
                <div className={`preview-empty ${previewError ? 'error' : ''}`}>{previewError ? `プレビューエラー: ${previewError}` : 'プレビューを生成中です…'}</div>
              )}
              {selectedItem && selectedPlacement && !target.error && (
                <div className="preview-stats">
                  <span>{`\u7e2e\u5c0f\u7387: ${(selectedPlacement.scale * 100).toFixed(1)}%${selectedPlacement.scaledDown ? ' (\u81ea\u52d5\u7e2e\u5c0f)' : ''}`}</span>
                  <span>{`\u5de6\u53f3\u4f59\u767d: ${formatMm(pxToMm(target.widthPx - selectedPlacement.drawWidth, settings.dpi) / 2)} mm/\u5074`}</span>
                  <span>{`\u4e0a\u4e0b\u4f59\u767d: ${formatMm(pxToMm(target.heightPx - selectedPlacement.drawHeight, settings.dpi) / 2)} mm/\u5074`}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel action-panel">
        <div>
          <h2>3. 一括出力</h2>
          <p>各画像に指定DPIメタデータを書き込み、ZIPでまとめて保存します。</p>
        </div>
        <button className="primary-button" type="button" disabled={busy || items.length === 0 || Boolean(target.error)} onClick={() => void processAll()}>
          {busy ? '処理中…' : `ZIPを作成 (${items.length}件)`}
        </button>
      </section>

      {busy && <progress className="progress" max="100" value={progress} />}
      {message && <div className="message" role="status">{message}</div>}

      <section className="notice-grid">
        <article className="notice">
          <h3>自然な余白について</h3>
          <p>「ぼかし拡張」は端の画素を外側へ延長してからぼかし、その上に元画像を等倍で重ねます。人物・文字・規則的な柄を新しく生成するAIアウトペインティングではありません。</p>
        </article>
        <article className="notice warning">
          <h3>印刷時の注意</h3>
          <p>ブラウザCanvasはCMYK/ICCプロファイルの保持を保証しません。色校正が必要な入稿データは、出力後にPhotoshop等のカラーマネジメント対応ソフトで最終確認してください。印刷時は「実際のサイズ / 100%」を選択してください。</p>
        </article>
      </section>
    </main>
  );
}

export default App;
