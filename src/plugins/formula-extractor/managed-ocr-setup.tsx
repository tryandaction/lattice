"use client";
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/hooks/use-i18n';
import { cancelManagedFormulaOcr, getManagedFormulaOcrStatus, installManagedFormulaOcr, type ManagedFormulaOcrStatus } from '@/lib/formula-ocr-managed';
import { getPluginSetting, setPluginSetting } from '@/lib/plugins/runtime';

export function ManagedOcrSetup({ onReady }: { onReady: () => void }) {
  const { locale } = useI18n(); const zh = locale !== 'en-US';
  const [status, setStatus] = useState<ManagedFormulaOcrStatus | null>(null);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);
  const mounted = useRef(true);
  const activation = useRef(0);
  const activating = useRef(false);
  const installation = useRef<{ requestId: string; cancelled: boolean; cancellation: Promise<void> | null } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activation.current++; activating.current = false; installation.current = null; }; }, []);
  useEffect(() => {
    let live = true;
    let pending = false;
    const refresh = () => { if (pending) return; pending = true; void getManagedFormulaOcrStatus().then(value => { if (live) setStatus(value); }).catch(() => { if (live) setFailed(true); }).finally(() => { pending = false; }); };
    refresh(); const timer = setInterval(refresh, busy ? 600 : 5000);
    return () => { live = false; clearInterval(timer); };
  }, [busy]);
  if (!status || status.status === 'unsupported') return null;
  const activate = async () => {
    if (activating.current) return;
    activating.current = true;
    const request = ++activation.current;
    const job = status.status === 'ready' ? null : { requestId: crypto.randomUUID(), cancelled: false, cancellation: null as Promise<void> | null };
    installation.current = job;
    const originalCommand = getPluginSetting('formula-extractor', 'ocrCommand');
    const current = () => mounted.current && activation.current === request;
    setFailed(false); setCancelFailed(false); setBusy(true); setCancelPending(false); setCanCancel(Boolean(job));
    try {
      if (job) await installManagedFormulaOcr(job.requestId);
      await job?.cancellation;
      if (!current() || job?.cancelled) return;
      const checked = await getManagedFormulaOcrStatus();
      await job?.cancellation;
      if (!current() || job?.cancelled || getPluginSetting('formula-extractor', 'ocrCommand') !== originalCommand) return;
      if (checked.status !== 'ready') throw new Error('OCR_NOT_READY');
      await setPluginSetting('formula-extractor', 'ocrCommand', 'managed');
      if (current()) { setFailed(false); setCancelFailed(false); setStatus(checked); onReady(); }
    } catch {
      await job?.cancellation;
      if (current() && !job?.cancelled) { setFailed(true); setCancelFailed(false); }
    } finally {
      if (current()) {
        if (installation.current === job) installation.current = null;
        activating.current = false; setBusy(false); setCancelPending(false); setCanCancel(false);
        if (job?.cancelled) setStatus(value => value ? { ...value, status: 'cancelled', requestId: job.requestId } : value);
      }
    }
  };
  const cancel = async () => {
    const job = installation.current;
    if (!job || job.cancellation) return;
    const request = activation.current;
    const current = () => mounted.current && activation.current === request && installation.current === job;
    setCancelPending(true);
    job.cancellation = (async () => {
      try {
        const accepted = await cancelManagedFormulaOcr(job.requestId);
        if (!current()) return;
        if (accepted) { job.cancelled = true; setCanCancel(false); setCancelFailed(false); }
        else setCancelFailed(true);
      } catch { if (current()) setCancelFailed(true); }
      finally { if (current()) setCancelPending(false); }
    })();
    await job.cancellation;
    // The installation promise owns completion. A rejected cancellation must
    // neither unlock retry nor invalidate the still-running installation.
    if (current() && !job.cancelled) job.cancellation = null;
  };
  const progress = status.totalBytes ? Math.min(100, status.downloadedBytes / status.totalBytes * 100) : 0;
  const downloadSize=Math.ceil(status.totalBytes/(1024*1024));
  return <div className="space-y-2 rounded border border-border p-2 text-xs">
    <p>{zh ? `本地图片公式识别：首次启用下载约 ${downloadSize} MiB，图片仅在本机处理。无需配置 Python 或 PATH；结果仍需校正。` : `Local image formulas: first setup downloads about ${downloadSize} MiB. Images stay on this computer; no Python or PATH setup is needed. Results still need review.`}</p>
    {(busy || status.status === 'installing') ? <>
      <progress aria-label={zh ? '公式识别安装进度' : 'Formula setup progress'} value={progress} max={100} className="w-full" />
      <p role="status">{zh ? '正在下载、校验或准备识别引擎…' : 'Downloading, verifying or preparing the engine…'} {Math.round(progress)}%</p>
      <button type="button" disabled={!canCancel || cancelPending} onClick={() => void cancel()} className="rounded border px-2 py-1">{zh ? '取消下载' : 'Cancel setup'}</button>
    </> : <button type="button" onClick={() => void activate()} className="rounded border border-primary/40 px-2 py-1 text-primary">{status.status === 'ready' ? (zh ? '使用已安装的本地识别' : 'Use installed local engine') : (zh ? '启用本地图片公式识别' : 'Set up local formula recognition')}</button>}
    {cancelFailed ? <p role="alert" className="text-destructive">{zh ? '取消未成功，安装仍在执行。可再次取消，或等待安装完成。' : 'Cancellation did not succeed. Setup is still running; try cancelling again or wait for it to finish.'}</p> : failed && <p role="alert" className="text-destructive">{zh ? '准备未完成。已校验的下载会保留，可重试；原文和批注不受影响。' : 'Setup did not finish. Verified downloads are kept for retry; documents and annotations are unchanged.'}</p>}
  </div>;
}
