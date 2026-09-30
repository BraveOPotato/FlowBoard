import { useState } from 'react';
import { useFlowStore } from '../store/useFlowStore';
import { WORKER_URL } from '../constants';
import { Icon } from '../components/Icon';
import { cx } from '../utils';
import { Modal } from './Modal';
import s from './Modal.module.css';
import ui from '../components/ui.module.css';

const INTERVALS = [
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 600, label: 'Every 10 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
  { value: 3600, label: 'Every hour' },
];

export function SettingsModal({ inviteId }: { inviteId?: string }) {
  const workerStatus = useFlowStore((st) => st.workerStatus);
  const { workerUrl, syncInterval, saveSettings, joinBoard, exportData, importData, closeModal, toast } = useFlowStore.getState();
  const [url, setUrl] = useState(workerUrl || WORKER_URL);
  const [interval, setIntervalVal] = useState(syncInterval || 600);
  const [joinId, setJoinId] = useState(inviteId ?? '');
  const [joinPw, setJoinPw] = useState('');
  const [busy, setBusy] = useState<'save' | 'join' | null>(null);

  const save = async () => {
    setBusy('save');
    await saveSettings({ workerUrl: url.trim(), syncInterval: interval });
    setBusy(null);
    toast('Settings saved');
  };

  const join = async () => {
    if (!joinId.trim() || !joinPw) return toast('Board ID and password are required', '⚠');
    setBusy('join');
    const ok = await joinBoard(joinId.trim(), joinPw);
    setBusy(null);
    toast(ok ? 'Board joined' : 'Couldn’t find a board with that ID and password', ok ? '✓' : '⚠');
    if (ok) closeModal();
  };

  return (
    <Modal
      size="md"
      title={inviteId ? 'Join shared board' : 'Settings'}
      description={inviteId ? 'You were invited to a board. Enter its password to join.' : undefined}
      footer={<>
        <button className={cx(ui.btn, ui.secondary)} onClick={closeModal}>Close</button>
        {!inviteId && <button className={cx(ui.btn, ui.primary)} onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>}
      </>}
    >
      {!inviteId && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h3>Cloud sync</h3>
              <p>Sync boards through your Cloudflare Worker.</p>
            </div>
            <span className={cx(s.status, workerStatus && s.statusOk)}>{workerStatus ? 'Connected' : 'Unreachable'}</span>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="worker-url">Worker URL</label>
            <input id="worker-url" className={ui.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={WORKER_URL} spellCheck={false} />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="sync-interval">Sync interval</label>
            <select id="sync-interval" className={ui.input} value={interval} onChange={(e) => setIntervalVal(Number(e.target.value))}>
              {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
        </section>
      )}

      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h3>Join a shared board</h3>
            <p>Use the board ID and password from whoever shared it.</p>
          </div>
        </div>
        <form className={s.row} onSubmit={(e) => { e.preventDefault(); join(); }}>
          <div>
            <label className={ui.label} htmlFor="join-id">Board ID</label>
            <input id="join-id" className={ui.input} value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Paste board ID" spellCheck={false} />
          </div>
          <div>
            <label className={ui.label} htmlFor="join-pw">Password</label>
            <input id="join-pw" className={ui.input} type="password" value={joinPw} onChange={(e) => setJoinPw(e.target.value)} placeholder="Board password" autoFocus={!!inviteId} />
          </div>
          <button type="submit" hidden />
        </form>
        <div className={s.actions}>
          <button className={cx(ui.btn, ui.secondary)} onClick={join} disabled={busy === 'join'}>
            <Icon name="users" size={15} /> {busy === 'join' ? 'Joining…' : 'Join board'}
          </button>
        </div>
      </section>

      {!inviteId && (
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h3>Backup</h3>
              <p>Export everything to a JSON file, or merge in a previous export.</p>
            </div>
          </div>
          <div className={s.actions}>
            <button className={cx(ui.btn, ui.secondary)} onClick={exportData}>
              <Icon name="download" size={15} /> Export JSON
            </button>
            <label className={cx(ui.btn, ui.secondary)}>
              <Icon name="upload" size={15} /> Import JSON
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try { await importData(await f.text()); } catch { toast('That file isn’t a valid FlowBoard export', '⚠'); }
                }}
              />
            </label>
          </div>
        </section>
      )}
    </Modal>
  );
}
