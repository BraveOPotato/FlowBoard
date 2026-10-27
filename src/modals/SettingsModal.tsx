import { useEffect, useId, useState } from 'react';
import { useFlowStore, sync } from '../store/useFlowStore';
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
const TABS = ['General', 'Boards', 'Backup'] as const;

export function SettingsModal({ inviteId }: { inviteId?: string }) {
  const workerStatus = useFlowStore((st) => st.workerStatus);
  const boards = useFlowStore((st) => st.boards);
  const { workerUrl, syncInterval, saveSettings, joinBoard, exportData, importData, closeModal, toast } = useFlowStore.getState();
  const [url, setUrl] = useState(workerUrl || WORKER_URL);
  const [interval, setIntervalVal] = useState(syncInterval || 600);
  const [joinId, setJoinId] = useState(inviteId ?? '');
  const [joinPw, setJoinPw] = useState('');
  const [joinError, setJoinError] = useState('');
  const [busy, setBusy] = useState<'save' | 'join' | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('General');
  const settingsId = useId();
  const [passwords, setPasswords] = useState<Record<string, string | undefined>>({});
  const [shownPasswords, setShownPasswords] = useState<string[]>([]);

  useEffect(() => {
    sync.getAllBoardCreds().then(creds => setPasswords(Object.fromEntries(creds.map(c => [c.boardId, c.password])))).catch(() => {});
  }, []);

  const save = async () => {
    setBusy('save');
    try { await saveSettings({ workerUrl: url.trim(), syncInterval: interval }); toast('Settings saved'); }
    catch (error) { toast((error as Error).message, '⚠'); }
    finally { setBusy(null); }
  };

  const join = async () => {
    setJoinError('');
    if (!joinId.trim() || !joinPw) return setJoinError('Board ID and password are required.');
    setBusy('join');
    try {
      const ok = await joinBoard(joinId.trim(), joinPw);
      if (ok) { toast('Board joined'); closeModal(); }
      else setJoinError('No board matches this ID and password on the configured worker. Check the ID, password and Worker URL.');
    } catch (error) { setJoinError(error instanceof Error ? error.message : 'Unable to join the board. Please retry.'); }
    finally { setBusy(null); }
  };

  return (
    <Modal
      size="md"
      title={inviteId ? 'Join shared board' : 'Settings'}
      description={inviteId ? 'You were invited to a board. Enter its password to join.' : undefined}
      footer={<>
        <button className={cx(ui.btn, ui.secondary)} onClick={closeModal}>Close</button>
        {!inviteId && tab === 'General' && <button className={cx(ui.btn, ui.primary)} onClick={save} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>}
      </>}
    >
      {!inviteId && (
        <nav className={s.settingsTabs} role="tablist" aria-label="Settings">
          {TABS.map((name, index) => (
            <button key={name} type="button" role="tab" id={`${settingsId}-tab-${name}`} aria-controls={`${settingsId}-panel-${name}`}
              aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} className={s.settingsTab} disabled={busy !== null}
              onClick={() => setTab(name)} onKeyDown={e => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                e.preventDefault();
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1
                  : (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
                setTab(TABS[next]);
                document.getElementById(`${settingsId}-tab-${TABS[next]}`)?.focus();
              }}>{name}</button>
          ))}
        </nav>
      )}
      {!inviteId && (
        <div role="tabpanel" id={`${settingsId}-panel-General`} aria-labelledby={`${settingsId}-tab-General`} hidden={tab !== 'General'}>
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
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h3>Contact us</h3>
                <p>Have a question, found a bug, or want to suggest a feature?</p>
              </div>
            </div>
            <div className={s.actions}>
              <a className={cx(ui.btn, ui.secondary)} href="mailto:abdullah@alkhafaji.dev">
                Contact via email
              </a>
              <a className={cx(ui.btn, ui.secondary)} href="https://github.com/BraveOPotato/FlowBoard/issues/new" target="_blank" rel="noopener noreferrer">
                <Icon name="link" size={15} /> Contact via GitHub
              </a>
            </div>
          </section>
        </div>
      )}

      <div role={inviteId ? undefined : 'tabpanel'} id={inviteId ? undefined : `${settingsId}-panel-Boards`}
        aria-labelledby={inviteId ? undefined : `${settingsId}-tab-Boards`} hidden={!inviteId && tab !== 'Boards'}>
        {!inviteId && boards.length > 0 && (
          <section className={s.section}>
            <div className={s.sectionHead}>
              <div>
                <h3>Board passwords</h3>
                <p>Saved on this device only, never sent to the worker or included in exports.</p>
              </div>
            </div>
            {boards.map(board => {
              const password = passwords[board.id];
              const shown = shownPasswords.includes(board.id);
              return (
                <div className={ui.field} key={board.id}>
                  <label className={ui.label} htmlFor={`board-pw-${board.id}`}>{board.name}</label>
                  {password === undefined ? <p className={ui.hint}>Not saved on this device. Rejoin the board with its password to save it.</p> : (
                    <div className={s.passwordRow}>
                      <input id={`board-pw-${board.id}`} className={ui.input} type={shown ? 'text' : 'password'} value={password} readOnly spellCheck={false} autoComplete="off" />
                      <button type="button" className={cx(ui.btn, ui.secondary)} aria-pressed={shown} aria-label={`${shown ? 'Hide' : 'Show'} password for ${board.name}`}
                        onClick={() => setShownPasswords(ids => shown ? ids.filter(id => id !== board.id) : [...ids, board.id])}>{shown ? 'Hide' : 'Show'}</button>
                    </div>
                  )}
                </div>
              );
            })}
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
          {joinError && <p className={s.error} role="alert">{joinError}</p>}
          <div className={s.actions}>
            <button className={cx(ui.btn, ui.secondary)} onClick={join} disabled={busy !== null}>
              <Icon name="users" size={15} /> {busy === 'join' ? 'Joining…' : 'Join board'}
            </button>
          </div>
        </section>
      </div>

      {!inviteId && (
        <section className={s.section} role="tabpanel" id={`${settingsId}-panel-Backup`} aria-labelledby={`${settingsId}-tab-Backup`} hidden={tab !== 'Backup'}>
          <div className={s.sectionHead}>
            <div>
              <h3>Backup</h3>
              <p>Export everything to a JSON file, or merge in a previous export. Merging never restores deleted cards.</p>
            </div>
          </div>
          <div className={s.actions}>
            <button className={cx(ui.btn, ui.secondary)} onClick={exportData} disabled={busy !== null}>
              <Icon name="download" size={15} /> Export JSON
            </button>
            <label className={cx(ui.btn, ui.secondary)}>
              <Icon name="upload" size={15} /> Import JSON
              <input
                type="file"
                accept=".json,application/json"
                hidden
                disabled={busy !== null}
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
