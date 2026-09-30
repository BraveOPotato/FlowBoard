import { useFlowStore } from '../store/useFlowStore';
import { THEMES } from '../constants';
import { Icon } from '../components/Icon';
import { cx } from '../utils';
import { Modal } from './Modal';
import type { ThemeDef } from '../types';
import s from './ThemeModal.module.css';

/** Miniature board drawn with the theme's own tokens. */
function Preview({ t }: { t: ThemeDef }) {
  return (
    <div className={s.preview} style={{ background: t.canvas }}>
      <div className={s.pSidebar} style={{ background: t.sidebar, borderColor: t.line }}>
        <i style={{ background: t.accent }} />
        <b style={{ background: t.fgSubtle }} />
        <b style={{ background: t.fgSubtle, opacity: 0.6 }} />
      </div>
      <div className={s.pCols}>
        {[2, 3, 1].map((n, i) => (
          <div key={i} className={s.pCol} style={{ background: t.surface, borderColor: t.line }}>
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className={s.pCard} style={{ background: t.card, borderColor: t.line }}>
                <span style={{ background: i === 0 && j === 0 ? t.accent : t.fgMuted }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThemeModal() {
  const activeTheme = useFlowStore((st) => st.activeTheme);
  const saveTheme = useFlowStore((st) => st.saveTheme);
  return (
    <Modal size="lg" title="Themes" description="Changes apply instantly and are saved on this device.">
      {(['dark', 'light'] as const).map((scheme) => (
        <section key={scheme} className={s.group}>
          <h3 className={s.groupTitle}>{scheme === 'dark' ? 'Dark' : 'Light'}</h3>
          <div className={s.grid}>
            {THEMES.filter((t) => t.scheme === scheme).map((t) => (
              <button
                key={t.id}
                className={cx(s.tile, activeTheme === t.id && s.active)}
                onClick={() => saveTheme(t.id)}
                aria-pressed={activeTheme === t.id}
              >
                <Preview t={t} />
                <span className={s.label}>
                  <span className={s.swatch} style={{ background: t.accent }} />
                  {t.label}
                  {activeTheme === t.id && <Icon name="check" size={14} strokeWidth={2.4} className={s.check} />}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  );
}
