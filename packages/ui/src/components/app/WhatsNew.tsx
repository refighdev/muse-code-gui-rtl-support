import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useApp, useController } from "../../app/context.js";
import { CHANGELOG, CHANGELOG_URL, highlights, newEntries, runningVersion } from "../../model/changelog.js";
import { ArrowSquareOutIcon, ScrollIcon, XIcon } from "../ui/icons.js";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * What changed, either because the app updated itself or because Settings asked for it: a small
 * card in the toast stack with a few headlines and a link to the full notes. The notes are built
 * in, so this costs no request and says the same thing offline; opening it sends nothing.
 *
 * The desktop shell reports the version it runs; the browser and the editor extension run the
 * interface they were built with. A first run records the version and stays quiet: there is
 * nothing to have missed.
 */
export function WhatsNew() {
  const controller = useController();
  const current = useApp((s) => runningVersion(s.updates));
  const seen = useApp((s) => s.prefs.lastSeenVersion);
  const asked = useApp((s) => s.whatsNewOpen);
  const [dismissed, setDismissed] = useState(false);
  const reduce = useReducedMotion();
  const titleId = useId();

  useEffect(() => {
    // A version with nothing to show is recorded straight away, so the notes are not kept waiting
    // for a release that happens to have an entry.
    if (current && seen === null) {
      controller.setPrefs({ lastSeenVersion: current });
    }
  }, [controller, current, seen]);

  const missed = newEntries(seen, current);
  // Asked for with nothing missed: the latest notes, which is what someone reading Settings wants.
  const entries = asked && missed.length === 0 ? CHANGELOG.slice(0, 1) : missed;
  const lines = highlights(entries);
  const open = lines.length > 0 && (asked || !dismissed);

  const close = () => {
    setDismissed(true);
    controller.setWhatsNewOpen(false);
    if (current) {
      controller.setPrefs({ lastSeenVersion: current });
    }
  };

  const version = entries[0]?.version ?? "";
  return (
    <AnimatePresence initial={!reduce}>
      {open ? (
        <motion.li
          key="whats-new"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="pointer-events-auto relative"
        >
          <section aria-labelledby={titleId} className="flex items-start gap-3 rounded-2xl bg-raised p-3 shadow-pop">
            <span className="mt-px inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-active text-muted">
              <ScrollIcon size={14} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 id={titleId} className="text-sm leading-5 font-medium text-fg">
                What's new in v{version}
              </h2>
              {entries.length > 1 ? (
                <p className="mt-0.5 text-xs leading-4 text-muted tabular-nums">
                  {entries.length} releases since v{seen}
                </p>
              ) : null}
              <ul className="mt-2 flex flex-col gap-1.5">
                {lines.map((line) => (
                  <li key={line} className="flex gap-2 text-xs leading-4 break-words text-muted">
                    <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-subtle" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`${CHANGELOG_URL}#v${version}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-active px-3 text-xs font-medium text-fg transition-colors hover:bg-hover"
              >
                Full changelog <ArrowSquareOutIcon size={12} />
              </a>
            </div>
            <button
              type="button"
              aria-label="Dismiss what's new"
              onClick={close}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <XIcon size={14} />
            </button>
          </section>
        </motion.li>
      ) : null}
    </AnimatePresence>
  );
}
