const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
const LABEL = {
  checking: 'Checking for the update…',
  downloading: 'Downloading…',
  verifying: 'Verifying the download…',
  preparing: 'Preparing files…',
  waitingForClose: 'Waiting for Null IDE to close…',
  installing: 'Installing…',
  restarting: 'Starting Null IDE…',
  busy: 'Another update or download is already running.',
  needsReapproval: 'Updated. The Windows 11 context menu needs one-time administrator approval; run the Null IDE installer to enable it.',
};
const mb = (n) => (n / 1048576).toFixed(1);

function show(...ids) {
  for (const b of document.querySelectorAll('#actions button')) b.hidden = !ids.includes(b.id);
}

function render(p) {
  $('bar').hidden = p.state !== 'downloading';
  $('detail').textContent = '';
  if (p.state === 'downloading') {
    $('bar').value = p.total ? (p.bytes / p.total) * 100 : 0;
    $('detail').textContent = `${mb(p.bytes)} of ${mb(p.total)} MB (${mb(p.bytesPerSec)} MB/s)`;
  }
  if (p.state === 'failed') {
    $('title').textContent = 'Update failed';
    $('status').textContent = p.message;
    $('detail').textContent = p.log ? `Log: ${p.log}` : '';
    return show('copy', 'close');
  }
  $('status').textContent = LABEL[p.state] ?? p.state;
  if (p.state === 'needsReapproval') return show('close');
  show();
}

listen('progress', (e) => render(e.payload));
listen('locked', (e) => {
  $('status').textContent = `Null IDE is still running (${e.payload.join(', ')}). Save your work and close it, or use Close Null IDE.`;
  show('retry', 'force', 'cancel');
});
$('retry').onclick = () => { show(); invoke('action', { name: 'retry' }); };
$('force').onclick = () => { show(); invoke('action', { name: 'force' }); };
$('cancel').onclick = () => { show(); invoke('action', { name: 'cancel' }); };
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(await invoke('diagnostics'));
  $('copy').textContent = 'Copied';
};
$('close').onclick = () => invoke('quit');
invoke('ui_ready');
