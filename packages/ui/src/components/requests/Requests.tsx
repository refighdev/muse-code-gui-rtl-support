import { CaretDownIcon, CaretUpIcon, ChatCircleDotsIcon, CheckCircleIcon, CheckIcon, CircleIcon, ClockIcon, ListChecksIcon, LockIcon, PencilSimpleIcon, PlugsIcon, ShieldWarningIcon, XCircleIcon, XIcon } from "../ui/icons.js";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useApp, useController } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import type { LocalEcho } from "../../model/fold.js";
import { describeApproval } from "../../model/format.js";
import type { ApprovalChoice, ApprovalRequest, TodoItem, UserInputAnswer, UserInputQuestion, UserInputRequest } from "../../types.js";
import { Tip } from "../ui/overlays.js";
import { Button, IconButton, Shortcut, Spinner, cn } from "../ui/primitives.js";
import { RollingDigits } from "../ui/sourced.js";

/** True while the event is going to a text field, where a bare key belongs to the text and not to a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

const PANEL = "enter-up overflow-hidden rounded-2xl bg-raised shadow-[0_0_0_1px_var(--warn-line),0_2px_8px_-4px_oklch(0_0_0/0.18)]";

/** Refusals carry a cross, a plain yes a tick, and a yes that writes a rule the heavier badge. */
function choiceIcon(choice: ApprovalChoice) {
  if (choice.decision !== "approved") {
    return <XIcon size={13} />;
  }
  return choice.rulePreview ? <CheckCircleIcon size={13} /> : <CheckIcon size={13} />;
}

/** The refusal among the offered choices, whatever the host calls it. */
function refusalOf(choices: readonly ApprovalChoice[]): ApprovalChoice | undefined {
  return choices.find((choice) => choice.decision !== "approved");
}

export function ApprovalPanel(props: { request: ApprovalRequest; primary: boolean }) {
  const controller = useController();
  const { request } = props;
  const busy = useApp((s) => Boolean(s.busy[`approval:${request.approvalId}`]));
  const armed = useApp((s) => s.bypassAll || s.bypassThreads.includes(request.sessionId));
  const description = describeApproval(request);
  const choices = request.availableChoices ?? [];
  const primaryChoice = choices.find((c) => c.decision === "approved") ?? choices[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const [feedbackChoice, setFeedbackChoice] = useState<ApprovalChoice | null>(null);
  const [feedback, setFeedback] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const backTo = useRef<string | null>(null);
  // Leaving the feedback form puts focus back on the choice that opened it, not the top of the page.
  useLayoutEffect(() => {
    if (feedbackChoice || !backTo.current) {
      return;
    }
    const id = backTo.current;
    backTo.current = null;
    sectionRef.current?.querySelector<HTMLElement>(`[data-choice="${CSS.escape(id)}"]`)?.focus();
  }, [feedbackChoice]);

  const pick = (choice: ApprovalChoice) => {
    if (choice.acceptsFeedback) {
      setFeedbackChoice(choice);
      return;
    }
    setChosen(choice.choiceId);
    void controller.decide(request, choice.choiceId, null);
  };

  useEffect(() => {
    if (!props.primary || feedbackChoice) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // A and R are the ones worth reaching for; the digits still pick any choice, including the rule ones.
      const key = event.key.toLowerCase();
      if (key === "a" || key === "r") {
        const wanted = key === "a" ? primaryChoice : refusalOf(choices);
        if (wanted) {
          event.preventDefault();
          pick(wanted);
        }
        return;
      }
      const index = Number(event.key) - 1;
      const choice = Number.isInteger(index) ? choices[index] : undefined;
      if (choice) {
        event.preventDefault();
        pick(choice);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stageCount = request.subject?.stages?.length ?? 0;
  return (
    <section ref={sectionRef} aria-label="Approval needed" className={PANEL}>
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-text">
          <ShieldWarningIcon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-fg">Muse wants to {lowerFirst(description.title)}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {request.protectedWrite ? "This touches a protected path. " : ""}
            {request.judgeEscalated ? "A safety check flagged it for you to review. " : ""}
            {stageCount > 1 ? `Part of a ${stageCount}-step command. ` : ""}
            Nothing runs until you decide.
          </p>
        </div>
      </div>
      {description.detail ? (
        <pre className="mx-4 mt-3 max-h-44 overflow-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg shadow-[0_0_0_1px_var(--border)] [overflow-wrap:anywhere]">
          {description.detail}
        </pre>
      ) : null}
      {feedbackChoice ? (
        <form
          className="flex flex-col gap-2 px-4 pt-3 pb-3.5"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setChosen(feedbackChoice.choiceId);
            void controller.decide(request, feedbackChoice.choiceId, feedback.trim() || null);
          }}
        >
          <label className="text-xs font-medium text-muted" htmlFor={`fb-${request.approvalId}`}>
            Tell Muse what to do instead (optional)
          </label>
          <textarea
            id={`fb-${request.approvalId}`}
            autoFocus
            rows={2}
            value={feedback}
            onChange={(event) => setFeedback(event.currentTarget.value)}
            className="w-full resize-none rounded-lg bg-sunken px-3 py-2 text-sm text-fg shadow-[0_0_0_1px_var(--border-strong)] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                backTo.current = feedbackChoice.choiceId;
                setFeedbackChoice(null);
              }}
            >
              Back
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={busy}>
              {feedbackChoice.label}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3.5">
          {choices.map((choice) => {
            const button = (
              <Button
                key={choice.choiceId}
                data-choice={choice.choiceId}
                size="sm"
                variant={choice === primaryChoice ? "primary" : "secondary"}
                loading={busy && chosen === choice.choiceId}
                disabled={busy}
                onClick={() => pick(choice)}
              >
                {choiceIcon(choice)}
                {choice.label}
              </Button>
            );
            return choice.rulePreview ? (
              <Tip key={choice.choiceId} label={`Adds the rule ${choice.rulePreview}`}>
                {button}
              </Tip>
            ) : (
              button
            );
          })}
          {choices.length === 0 ? <p className="text-xs text-muted">No choices were offered. Decide in the Muse terminal.</p> : null}
          {!armed && primaryChoice ? (
            <Tip label="Allow this and everything else this thread asks, until you close Muse Code GUI">
              <button
                type="button"
                onClick={() => controller.setThreadBypass(request.sessionId, true)}
                className="rounded-lg px-2 py-1 text-2xs text-subtle transition-colors duration-100 hover:bg-hover hover:text-fg"
              >
                Stop asking in this thread
              </button>
            </Tip>
          ) : null}
          {props.primary && choices.length > 1 ? (
            <span className="ml-auto hidden items-center gap-1.5 text-2xs text-subtle sm:inline-flex">
              <Shortcut keys={["A"]} />
              allow
              <Shortcut keys={["R"]} />
              reject
              {choices.length > 2 ? <span className="text-subtle">· 1 to {Math.min(choices.length, 9)}</span> : null}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}

type Picks = Record<string, string[]>;
type Custom = Record<string, string>;

function isAnswered(question: UserInputQuestion, picks: Picks, custom: Custom): boolean {
  if (custom[question.id]?.trim()) {
    return true;
  }
  return (picks[question.id]?.length ?? 0) >= Math.max(1, question.selection.minSelections ?? 1);
}

function answerFor(question: UserInputQuestion, picks: Picks, custom: Custom): UserInputAnswer {
  const own = custom[question.id]?.trim();
  if (own || question.options.length === 0) {
    return { questionId: question.id, freeText: own ?? "" };
  }
  if (question.selection.mode === "multiple") {
    return { questionId: question.id, selectedLabels: picks[question.id] ?? [] };
  }
  return { questionId: question.id, selectedLabel: picks[question.id]?.[0] ?? "" };
}

/**
 * Muse's questions, one at a time. Single-choice answers advance on their own; the last one
 * sends. A "something else" row takes a free-text answer.
 * via Beautiful UI ApprovalCard (beautifului.dev), MIT (c) 2026 Shane Levine.
 * Adapted: real MSP questions and answers, Muse Code GUI tokens, crossfade instead of a measured slide.
 */
export function QuestionPanel(props: { request: UserInputRequest; keyboard: boolean }) {
  const ime = useImeGuard();
  const controller = useController();
  const { request } = props;
  const busy = useApp((s) => Boolean(s.busy[`input:${request.userInputId}`]));
  const questions = request.questions ?? [];
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Picks>({});
  const [custom, setCustom] = useState<Custom>({});
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const question = questions[index];
  const last = index >= questions.length - 1;
  const sectionRef = useRef<HTMLElement>(null);
  const shown = useRef(question?.id);
  // The next question replaces the options that had focus. Put it on the new question's first option, or
  // the page would drop it and a screen reader would start again from the top.
  useLayoutEffect(() => {
    if (shown.current === question?.id) {
      return;
    }
    shown.current = question?.id;
    const section = sectionRef.current;
    const active = document.activeElement;
    if (section && (active === null || active === document.body || section.contains(active))) {
      section.querySelector<HTMLElement>('[role="radio"], [role="checkbox"], input')?.focus();
    }
  }, [question?.id]);

  const send = (nextPicks: Picks, nextCustom: Custom) => {
    const missing = questions.findIndex((q) => !isAnswered(q, nextPicks, nextCustom));
    if (missing >= 0) {
      setIndex(missing);
      return;
    }
    void controller.answer(
      request,
      questions.map((q) => answerFor(q, nextPicks, nextCustom)),
    );
  };

  const advance = (nextPicks: Picks, nextCustom: Custom) => {
    if (last) {
      send(nextPicks, nextCustom);
    } else {
      setIndex((i) => Math.min(questions.length - 1, i + 1));
    }
  };

  const choose = (label: string) => {
    if (!question || busy) {
      return;
    }
    const nextCustom = { ...custom, [question.id]: "" };
    setCustom(nextCustom);
    if (question.selection.mode === "multiple") {
      setPicks((previous) => {
        const current = previous[question.id] ?? [];
        if (current.includes(label)) {
          return { ...previous, [question.id]: current.filter((l) => l !== label) };
        }
        const max = question.selection.maxSelections;
        return max && current.length >= max ? previous : { ...previous, [question.id]: [...current, label] };
      });
      return;
    }
    const nextPicks = { ...picks, [question.id]: [label] };
    setPicks(nextPicks);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => advance(nextPicks, nextCustom), 420);
  };

  useEffect(() => {
    if (!props.keyboard || !question) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const option = question.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        choose(option.label);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!question) {
    return null;
  }
  const multiple = question.selection.mode === "multiple";
  const answered = isAnswered(question, picks, custom);
  return (
    <section ref={sectionRef} aria-label="Muse has a question" className={PANEL}>
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn-text">
          <ChatCircleDotsIcon size={15} />
        </span>
        <div key={question.id} className="enter-up min-w-0 flex-1">
          <p className="text-2xs font-medium text-subtle">{question.header || "Muse has a question"}</p>
          <h2 id={`q-${request.userInputId}-${question.id}`} className="mt-0.5 text-md leading-snug font-medium text-pretty text-fg">
            {question.question}
          </h2>
        </div>
      </div>
      <div
        key={`options-${question.id}`}
        role={multiple ? "group" : "radiogroup"}
        aria-labelledby={`q-${request.userInputId}-${question.id}`}
        className="enter-up mt-2 flex flex-col gap-px px-2.5"
      >
        {question.options.map((option, optionIndex) => {
          const on = picks[question.id]?.includes(option.label) ?? false;
          return (
            <button
              key={option.label}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              disabled={busy}
              onClick={() => choose(option.label)}
              className={cn(
                "group/opt flex items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-100 hover:bg-hover disabled:opacity-60",
                on && "bg-hover",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                  multiple ? "rounded-[5px]" : "rounded-full",
                  on ? "bg-inverse text-inverse-fg" : "text-transparent shadow-[inset_0_0_0_1.5px_var(--border-strong)]",
                )}
              >
                {multiple ? (
                  <CheckIcon size={11} />
                ) : (
                  <span className="size-1.5 rounded-full bg-current transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm transition-colors duration-150", on ? "font-medium text-fg" : "text-muted")}>{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-xs leading-snug text-subtle">{option.description}</span> : null}
              </span>
              {props.keyboard && optionIndex < 9 ? (
                <span className="mt-0.5 font-mono text-2xs text-subtle opacity-0 transition-opacity group-hover/opt:opacity-100" aria-hidden="true">
                  {optionIndex + 1}
                </span>
              ) : null}
            </button>
          );
        })}
        <label className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors focus-within:bg-hover hover:bg-hover">
          <span className="flex size-4 shrink-0 items-center justify-center text-subtle" aria-hidden="true">
            <PencilSimpleIcon size={12} />
          </span>
          <input
            value={custom[question.id] ?? ""}
            maxLength={500}
            disabled={busy}
            aria-label={question.options.length > 0 ? "Answer something else" : "Your answer"}
            placeholder={question.options.length > 0 ? "Something else" : "Type your answer"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCustom((previous) => ({ ...previous, [question.id]: value }));
              if (!multiple) {
                setPicks((previous) => ({ ...previous, [question.id]: [] }));
              }
            }}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyUp={ime.onKeyUp}
            onKeyDown={(event) => {
              if (ime.isImeKey(event)) {
                return;
              }
              if (event.key === "Enter" && answered) {
                event.preventDefault();
                advance(picks, custom);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle focus-visible:outline-none"
          />
        </label>
        {multiple && question.selection.maxSelections ? (
          <p className="px-2 pt-1 text-xs text-subtle">Choose up to {question.selection.maxSelections}</p>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-line px-3 py-2.5">
        {questions.length > 1 ? (
          <div className="flex items-center gap-0.5 text-subtle">
            <IconButton size="xs" label="Previous question" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              <CaretUpIcon size={14} />
            </IconButton>
            <RollingDigits className="text-xs font-medium" value={`${index + 1} / ${questions.length}`} />
            <IconButton size="xs" label="Next question" disabled={last} onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              <CaretDownIcon size={14} />
            </IconButton>
          </div>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void controller.skipQuestion(request)}>
          Skip
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!answered} onClick={() => advance(picks, custom)}>
          {last ? "Send answer" : "Continue"}
        </Button>
      </div>
    </section>
  );
}

/** Decorative: the step's state is read as words before its text, so the mark adds no stop of its own. */
function TodoMark(props: { status: string }) {
  switch (props.status) {
    case "completed":
      return <CheckCircleIcon size={15} className="shrink-0 text-ok" aria-hidden="true" />;
    case "inProgress":
      return <Spinner size={13} className="m-px text-accent-text" />;
    case "cancelled":
      return <XCircleIcon size={15} className="shrink-0 text-subtle" aria-hidden="true" />;
    default:
      return <CircleIcon size={15} className="shrink-0 text-[var(--border-strong)]" aria-hidden="true" />;
  }
}

const TODO_STATE: Record<string, string> = { completed: "Done", inProgress: "In progress", cancelled: "Cancelled" };

/** Closes a dock card until the user brings it back from the thread's top bar. */
export function CloseCard(props: { label: string; onClose: () => void }) {
  return (
    <Tip label={`${props.label}. Bring it back from the top bar.`}>
      <IconButton size="sm" label={props.label} onClick={props.onClose} className="ml-1 shrink-0">
        <XIcon size={13} />
      </IconButton>
    </Tip>
  );
}

export function PlanPanel(props: { sessionId: string; items: TodoItem[] }) {
  const controller = useController();
  // Kept in prefs, not here: this panel unmounts whenever the user looks at another thread.
  const cardKey = `plan:${props.sessionId}`;
  const open = useApp((s) => !s.prefs.collapsedCards.includes(cardKey));
  const hidden = useApp((s) => s.prefs.hiddenCards.includes(cardKey));
  const done = props.items.filter((i) => i.status === "completed").length;
  const active = props.items.find((i) => i.status === "inProgress");
  if (hidden) {
    return null;
  }
  return (
    <section aria-label="Plan" className="enter-up overflow-hidden rounded-2xl bg-raised shadow-card">
      <div className="flex items-center pr-1.5 transition-colors hover:bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => controller.setCardOpen(cardKey, !open)}
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 pl-3.5 text-left"
        >
          <ListChecksIcon size={15} className="shrink-0 text-subtle" />
          <span className="text-sm font-medium text-fg">Plan</span>
          <span className="shrink-0 text-xs text-subtle tabular-nums">
            <RollingDigits value={String(done)} /> of {props.items.length} done
          </span>
          {!open && active ? <span className="min-w-0 truncate text-xs text-muted">{active.activeForm ?? active.text}</span> : null}
          <span className="flex-1" />
          <CaretDownIcon size={14} className={cn("shrink-0 text-subtle transition-transform duration-200", !open && "-rotate-90")} />
        </button>
        <CloseCard label="Hide the plan" onClose={() => controller.setCardHidden(cardKey, true)} />
      </div>
      {open ? (
        <ol className="flex max-h-52 flex-col gap-1.5 overflow-y-auto px-3.5 pb-3">
          {props.items.map((item, index) => (
            <li key={index} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-4 items-center justify-center" aria-hidden="true">
                <TodoMark status={item.status} />
              </span>
              <span
                className={cn(
                  "min-w-0",
                  item.status === "completed" && "text-subtle line-through decoration-[var(--border-strong)]",
                  item.status === "inProgress" && "font-medium text-fg",
                  item.status !== "completed" && item.status !== "inProgress" && "text-muted",
                )}
              >
                <span className="sr-only">{TODO_STATE[item.status] ?? "To do"}: </span>
                {item.status === "inProgress" ? (item.activeForm ?? item.text) : item.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function QueuedList(props: { sessionId: string; items: LocalEcho[] }) {
  const controller = useController();
  return (
    <div className="flex flex-col gap-1.5">
      {props.items.map((echo) => (
        <div key={echo.localId} className="enter-up flex items-center gap-2.5 rounded-xl bg-sunken py-1.5 pr-1.5 pl-3 shadow-[0_0_0_1px_var(--border)]">
          <ClockIcon size={14} className="shrink-0 text-subtle" />
          <span className="shrink-0 text-xs font-medium text-subtle">Queued</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{echo.text}</span>
          <Tip label="Remove from the queue">
            <IconButton size="xs" label="Remove from the queue" onClick={() => void controller.unqueue(props.sessionId, echo)}>
              <XIcon size={13} />
            </IconButton>
          </Tip>
        </div>
      ))}
    </div>
  );
}

/** Muse's auto-reviewer holds an approval: nothing to decide here unless it hands the call back. */
export function ReviewingNotice(props: { count: number }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <Spinner size={15} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {props.count === 1 ? "Auto-review is checking an action" : `Auto-review is checking ${props.count} actions`}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Muse asks you only if the reviewer passes the decision back.
        </p>
      </div>
    </div>
  );
}

/**
 * The thread still shows a turn running, but its stream went quiet and reloading from history did
 * not move it on. Saying so beats a spinner that will never resolve: the work itself usually
 * finished, and the transcript catches up once the backend starts talking again (#42).
 *
 * `onKeepLive` is passed only while catch-up is off in Settings. It is the way out that lasts: with
 * it on, Muse Code GUI asks Muse for the updates that stopped arriving, for this thread and every other.
 */
export function StalledNotice(props: { onRetry: () => void; onKeepLive?: () => void; busy: boolean }) {
  const reload = (
    <Button size="sm" onClick={props.onRetry} loading={props.busy}>
      Reload
    </Button>
  );
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <PlugsIcon size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">This thread stopped receiving updates</p>
        <p className="mt-0.5 text-xs text-muted">
          Muse is most likely still working, and may well have finished. Reloading the history twice did not move
          this turn on, so nothing more arrives here until it does. Restarting Muse Code GUI reconnects it.
        </p>
      </div>
      {props.onKeepLive ? (
        // Stacked, so the second button costs the text no width on a narrow window.
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <Tip side="top" label="Turns on a setting: when Muse stops sending a thread's updates, Muse Code GUI asks for them every few seconds. Switch it off in Settings.">
            <Button size="sm" variant="primary" onClick={props.onKeepLive} disabled={props.busy}>
              Keep it live
            </Button>
          </Tip>
          {reload}
        </div>
      ) : (
        reload
      )}
    </div>
  );
}

export function ReadOnlyNotice(props: { reason: string | null; onRetry: () => void; busy: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-sunken px-4 py-3 shadow-[0_0_0_1px_var(--border)]">
      <LockIcon size={15} className="mt-0.5 shrink-0 text-subtle" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Open in another Muse session</p>
        <p className="mt-0.5 text-xs text-muted">
          Another host, usually the Muse terminal, holds this thread. Close it there, then take over here.
        </p>
      </div>
      <Button size="sm" onClick={props.onRetry} loading={props.busy}>
        Take over
      </Button>
    </div>
  );
}
