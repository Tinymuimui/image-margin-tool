import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { embedDpiMetadata } from './lib/dpiMetadata';
import { downloadBlob, isSupportedImage, outputFileName, resolveOutputFormat } from './lib/files';
import {
  assertCanvasSize,
  calculatePlacement,
  canvasToBlob,
  decodeImage,
  renderImage,
  renderPreview,
} from './lib/image';
import { formatMm, mmToPx, pxToMm } from './lib/math';
import type { DecodedImage } from './lib/image';
import type { ImageItem, RenderBackgroundImage, Settings } from './types';

const DEFAULT_SETTINGS: Settings = {
  widthMm: 100,
  heightMm: 150,
  dpi: 300,
  mode: 'blur',
  blurMm: 2.5,
  backgroundColor: '#ffffff',
  backgroundFit: 'cover',
  backgroundOpacity: 1,
  backgroundBrightness: 1,
  outputFormat: 'same',
  jpegQuality: 0.95,
};

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

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

  const backgroundRequirementError = settings.mode === 'custom' && !backgroundFile
    ? 'カスタム背景を使用する場合は背景画像を選択してください。'
    : '';

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

    try {
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
    } finally {
      setBusy(false);
    }
  }, []);

  const setCustomBackground = useCallback(async (file: File | null) => {
    if (!file) return;
    if (!isSupportedImage(file)) {
      setMessage('背景画像は JPEG または PNG を選択してください。');
      return;
    }

    try {
      const decoded = await decodeImage(file);
      decoded.close();
      setBackgroundFile(file);
      setMessage(`背景画像「${file.name}」を設定しました。`);
    } catch (error) {
      setMessage(`背景画像を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  useEffect(() => {
    if (!backgroundFile) {
      setBackgroundPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(backgroundFile);
    setBackgroundPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [backgroundFile]);

  useEffect(() => {
    let cancelled = false;
    let localUrl: string | null = null;

    const run = async () => {
      if (!selectedItem || target.error || target.widthPx === 0 || target.heightPx === 0) {
        setPreviewUrl(null);
        setPreviewError('');
        return;
      }
      if (backgroundRequirementError) {
        setPreviewUrl(null);
        setPreviewError(backgroundRequirementError);
        return;
      }

      setPreviewError('');
      setPreviewUrl(null);

      let foreground: DecodedImage | null = null;
      let background: DecodedImage | null = null;

      try {
        foreground = await decodeImage(selectedItem.file);
        if (settings.mode === 'custom' && backgroundFile) {
          background = await decodeImage(backgroundFile);
        }
        if (cancelled) return;

        const blurEnabled = settings.mode === 'blur' || settings.mode === 'custom';
        const blurPx = blurEnabled && settings.blurMm > 0
          ? mmToPx(settings.blurMm, settings.dpi)
          : 0;

        const backgroundImage: RenderBackgroundImage | undefined = background
          ? { source: background.source, width: background.width, height: background.height }
          : undefined;

        const preview = renderPreview(foreground.source, foreground.width, foreground.height, {
          targetWidth: target.widthPx,
          targetHeight: target.heightPx,
          mode: settings.mode,
          blurPx,
          backgroundColor: settings.backgroundColor,
          backgroundImage,
          backgroundFit: settings.backgroundFit,
          backgroundOpacity: settings.backgroundOpacity,
          backgroundBrightness: settings.backgroundBrightness,
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
      } catch (error) {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        foreground?.close();
        background?.close();
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [
    selectedItem,
    target.error,
    target.widthPx,
    target.heightPx,
    settings.mode,
    settings.blurMm,
    settings.dpi,
    settings.backgroundColor,
    settings.backgroundFit,
    settings.backgroundOpacity,
    settings.backgroundBrightness,
    backgroundFile,
    backgroundRequirementError,
  ]);

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
    if (backgroundRequirementError) {
      setMessage(backgroundRequirementError);
      return;
    }

    setBusy(true);
    setProgress(0);
    setMessage('画像を処理しています…');
    const zip = new JSZip();
    const failures: string[] = [];
    let background: DecodedImage | null = null;

    try {
      if (settings.mode === 'custom' && backgroundFile) {
        background = await decodeImage(backgroundFile);
      }

      const blurEnabled = settings.mode === 'blur' || settings.mode === 'custom';
      const blurPx = blurEnabled && settings.blurMm > 0
        ? mmToPx(settings.blurMm, settings.dpi)
        : 0;

      const backgroundImage: RenderBackgroundImage | undefined = background
        ? { source: background.source, width: background.width, height: background.height }
        : undefined;

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
              blurPx,
              backgroundColor: settings.backgroundColor,
              backgroundImage,
              backgroundFit: settings.backgroundFit,
              backgroundOpacity: settings.backgroundOpacity,
              backgroundBrightness: settings.backgroundBrightness,
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
      background?.close();
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

  const canProcess = !busy
    && items.length > 0
    && !target.error
    && !backgroundRequirementError;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Browser-only print utility</p>
          <h1>Print Margin Extender</h1>
          <p className="lead">
            元画像は、仕上がりサイズを超える場合だけアスペクト比を維持して自動縮小し、不足分に自然な余白を追加します。
            好みの背景画像も指定できます。画像はサーバーへ送信しません。
          </p>
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
              <option value="blur">元画像をぼかし拡張</option>
              <option value="custom">カスタム背景画像</option>
              <option value="edge">端を引き伸ばす</option>
              <option value="solid">単色</option>
            </select>
          </label>
          <label>
            <span>BGぼかし量 (mm)</span>
            <input
              type="number"
              min="0"
              max="20"
              step="0.1"
              disabled={settings.mode !== 'blur' && settings.mode !== 'custom'}
              value={settings.blurMm}
              onChange={(e) => updateSetting('blurMm', Number(e.target.value))}
            />
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

        {settings.mode === 'custom' && (
          <div className="custom-bg-panel">
            <div className="custom-bg-heading">
              <div>
                <strong>カスタム背景</strong>
                <p>1枚の背景画像を、処理するすべての画像に共通で使用します。</p>
              </div>
              <div className="custom-bg-actions">
                <button className="ghost-button" type="button" onClick={() => backgroundInputRef.current?.click()} disabled={busy}>
                  背景画像を選択
                </button>
                {backgroundFile && (
                  <button className="ghost-button danger" type="button" onClick={() => setBackgroundFile(null)} disabled={busy}>
                    背景を解除
                  </button>
                )}
              </div>
            </div>

            <input
              ref={backgroundInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) void setCustomBackground(file);
                e.currentTarget.value = '';
              }}
            />

            <div className="custom-bg-grid">
              <div className="background-file-card">
                {backgroundPreviewUrl ? (
                  <img src={backgroundPreviewUrl} alt="選択した背景画像" />
                ) : (
                  <div className="background-empty">背景画像未選択</div>
                )}
                <span>{backgroundFile?.name ?? 'JPEG / PNG を選択してください'}</span>
              </div>

              <label>
                <span>BG配置</span>
                <select value={settings.backgroundFit} onChange={(e) => updateSetting('backgroundFit', e.target.value as Settings['backgroundFit'])}>
                  <option value="cover">全面に敷く（推奨）</option>
                  <option value="contain">全体を表示</option>
                  <option value="stretch">引き伸ばして全面</option>
                </select>
              </label>

              <label>
                <span>BG不透明度 (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(settings.backgroundOpacity * 100)}
                  onChange={(e) => updateSetting('backgroundOpacity', Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
                />
              </label>

              <label>
                <span>BG明るさ (%)</span>
                <input
                  type="number"
                  min="0"
                  max="300"
                  step="5"
                  value={Math.round(settings.backgroundBrightness * 100)}
                  onChange={(e) => updateSetting('backgroundBrightness', Math.min(3, Math.max(0, Number(e.target.value) / 100)))}
                />
              </label>
            </div>

            {backgroundRequirementError && <div className="inline-error">{backgroundRequirementError}</div>}
          </div>
        )}

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
                        {autoScaled && placement ? `自動縮小 ${(placement.scale * 100).toFixed(1)}%` : '等倍で処理'}
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
                  <span>{`縮小率: ${(selectedPlacement.scale * 100).toFixed(1)}%${selectedPlacement.scaledDown ? ' (自動縮小)' : ''}`}</span>
                  <span>{`左右余白: ${formatMm(pxToMm(target.widthPx - selectedPlacement.drawWidth, settings.dpi) / 2)} mm/側`}</span>
                  <span>{`上下余白: ${formatMm(pxToMm(target.heightPx - selectedPlacement.drawHeight, settings.dpi) / 2)} mm/側`}</span>
                  {settings.mode === 'custom' && backgroundFile && (
                    <span>{`BG: ${backgroundFile.name} / ぼかし ${settings.blurMm}mm / 不透明度 ${Math.round(settings.backgroundOpacity * 100)}%`}</span>
                  )}
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
        <button className="primary-button" type="button" disabled={!canProcess} onClick={() => void processAll()}>
          {busy ? '処理中…' : `ZIPを作成 (${items.length}件)`}
        </button>
      </section>

      {busy && <progress className="progress" max="100" value={progress} />}
      {message && <div className="message" role="status">{message}</div>}

      <section className="notice-grid">
        <article className="notice">
          <h3>背景と余白について</h3>
          <p>「カスタム背景画像」は指定した1枚を全画像の背景に使用し、ぼかし量・不透明度・明るさ・配置を調整できます。前景の元画像にはBGぼかしを掛けません。</p>
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
