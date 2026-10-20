import { Command } from "cmdk";
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ArrowsClockwiseIcon, FolderIcon, FolderPlusIcon, MagnifyingGlassIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, MonitorIcon, MoonIcon, NotePencilIcon, ShieldSlashIcon, SidebarSimpleIcon, StackIcon, SunIcon } from "../ui/icons.js";
import { useMemo, type ReactNode } from "react";
import { useApp, useController, useNow } from "../../app/context.js";
import { useImeGuard } from "../../app/ime.js";
import { basename, relativeTime } from "../../model/format.js";
import { threadStatus } from "../../model/status.js";
import { Modal } from "../ui/overlays.js";
import { MOD, NEW_THREAD_KEYS, Shortcut } from "../ui/primitives.js";
import { StatusGlyph } from "../ui/StatusGlyph.js";

const GROUP =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle";
const ITEM =
  "flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-sm text-fg outline-none select-none data-[selected=true]:bg-hover";

function Item(props: { value: string; keywords?: string[]; onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <Command.Item value={props.value} keywords={props.keywords} onSelect={props.onSelect} className={ITEM}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted">{props.icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{props.children}</span>
      {props.hint ? <span className="shrink-0 text-xs text-subtle">{props.hint}</span> : null}
    </Command.Item>
  );
}

export function CommandPalette() {
  const ime = useImeGuard();
  const controller = useController();
  const open = useApp((s) => s.paletteOpen);
  const sessions = useApp((s) => s.sessions);
  const projects = useApp((s) => s.projects);
  const threads = useApp((s) => s.threads);
  const baseline = useApp((s) => s.prefs.baseline);
  const lastSeen = useApp((s) => s.prefs.lastSeen);
  const groupBy = useApp((s) => s.prefs.groupBy);
  const updates = useApp((s) => s.updates);
  const now = useNow(60_000, open);

  const sorted = useMemo(
    () =>
      Object.values(sessions).sort((a, b) =>
        a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.activityAt < b.activityAt ? 1 : -1,
      ),
    [sessions],
  );

  const run = (action: () => void) => {
    controller.setPaletteOpen(false);
    action();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => controller.setPaletteOpen(next)}
      title="Search threads, projects and actions"
      hideTitle
      bare
      className="top-[12%] w-[min(620px,calc(100%-16px))] overflow-hidden"
    >
      <Command loop label="Search threads, projects and actions">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <MagnifyingGlassIcon size={16} className="shrink-0 text-subtle" />
          <Command.Input
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyUp={ime.onKeyUp}
            onKeyDown={(event) => {
              // cmdk selects on Enter after compositionend in WebKit; stop IME keys before its root handler.
              if (ime.isImeKey(event)) {
                event.stopPropagation();
              }
            }}
            placeholder="Search threads, projects and actions"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle"
          />
        </div>
        <Command.List className="max-h-[min(440px,62vh)] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-10 text-center text-sm text-muted">Nothing matches that search.</Command.Empty>
          <Command.Group heading="Actions" className={GROUP}>
            <Item value="New thread" icon={<NotePencilIcon size={15} />} onSelect={() => run(() => controller.newThread())} hint={<Shortcut keys={NEW_THREAD_KEYS} />}>
              New thread
            </Item>
            <Item value="Add project folder" icon={<FolderPlusIcon size={15} />} onSelect={() => run(() => controller.setAddProjectOpen(true))}>
              Add project
            </Item>
            <Item value="Refresh threads from Muse" icon={<ArrowsClockwiseIcon size={15} />} onSelect={() => run(() => void controller.discoverAll())}>
              Refresh threads from Muse
            </Item>
            <Item
              value={groupBy === "project" ? "Group sidebar by status" : "Group sidebar by project"}
              icon={<StackIcon size={15} />}
              onSelect={() => run(() => controller.setGroupBy(groupBy === "project" ? "status" : "project"))}
            >
              {groupBy === "project" ? "Group sidebar by status" : "Group sidebar by project"}
            </Item>
            <Item value="Toggle sidebar" icon={<SidebarSimpleIcon size={15} />} onSelect={() => run(() => controller.toggleSidebar())} hint={<Shortcut keys={[MOD, "B"]} />}>
              Toggle sidebar
            </Item>
            <Item value="Theme system" keywords={["appearance"]} icon={<MonitorIcon size={15} />} onSelect={() => run(() => controller.setTheme("system"))}>
              Use system theme
            </Item>
            <Item value="Theme light" keywords={["appearance"]} icon={<SunIcon size={15} />} onSelect={() => run(() => controller.setTheme("light"))}>
              Use light theme
            </Item>
            <Item value="Theme dark" keywords={["appearance"]} icon={<MoonIcon size={15} />} onSelect={() => run(() => controller.setTheme("dark"))}>
              Use dark theme
            </Item>
            <Item value="Zoom in" keywords={["appearance", "bigger", "font size"]} icon={<MagnifyingGlassPlusIcon size={15} />} onSelect={() => run(() => controller.zoomIn())} hint={<Shortcut keys={[MOD, "+"]} />}>
              Zoom in
            </Item>
            <Item value="Zoom out" keywords={["appearance", "smaller", "font size"]} icon={<MagnifyingGlassMinusIcon size={15} />} onSelect={() => run(() => controller.zoomOut())} hint={<Shortcut keys={[MOD, "-"]} />}>
              Zoom out
            </Item>
            <Item value="Reset zoom" keywords={["appearance", "100%"]} icon={<ArrowCounterClockwiseIcon size={15} />} onSelect={() => run(() => controller.resetZoom())} hint={<Shortcut keys={[MOD, "0"]} />}>
              Reset zoom
            </Item>
            {updates?.status === "ready" ? (
              <Item value="Restart to update" keywords={["update", "install", "version"]} icon={<ArrowClockwiseIcon size={15} />} onSelect={() => run(() => controller.restartToUpdate())}>
                Restart to install Muse Code GUI {updates.update?.version ?? ""}
              </Item>
            ) : null}
            {updates ? (
              <Item value="Check for updates" keywords={["update", "version"]} icon={<ArrowsClockwiseIcon size={15} />} onSelect={() => run(() => controller.checkForUpdates())}>
                Check for updates
              </Item>
            ) : null}
          </Command.Group>
          {sorted.length > 0 ? (
            <Command.Group heading="Threads" className={GROUP}>
              {sorted.map((session) => {
                const status = threadStatus(session, {
                  fold: threads[session.sessionId]?.fold ?? null,
                  lastSeen: lastSeen[session.sessionId] ?? null,
                  baseline,
                  active: false,
                });
                return (
                  <Item
                    key={session.sessionId}
                    value={`${session.title} ${session.sessionId}`}
                    keywords={[basename(session.cwd)]}
                    icon={status === "idle" ? <span className="size-[7px] rounded-full bg-line-strong" /> : <StatusGlyph status={status} />}
                    onSelect={() => run(() => controller.openThread(session.sessionId))}
                    hint={relativeTime(session.activityAt, now)}
                  >
                    <span className="truncate">{session.title}</span>
                    {session.sandboxDisabled === true ? (
                      <span title="Sandbox off" className="flex shrink-0 items-center gap-1 text-warn-text">
                        <ShieldSlashIcon size={12} aria-hidden="true" />
                        <span className="sr-only">, sandbox off</span>
                      </span>
                    ) : null}
                    <span className="shrink-0 truncate text-xs text-subtle">{basename(session.cwd)}</span>
                  </Item>
                );
              })}
            </Command.Group>
          ) : null}
          {projects.length > 0 ? (
            <Command.Group heading="Projects" className={GROUP}>
              {projects.map((project) => (
                <Item
                  key={project.cwd}
                  value={`New thread in ${project.displayName} ${project.cwd}`}
                  icon={<FolderIcon size={15} />}
                  onSelect={() => run(() => controller.newThread(project.cwd))}
                >
                  <span className="truncate">New thread in {project.displayName}</span>
                  <span className="truncate text-xs text-subtle">{project.cwd}</span>
                </Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </Modal>
  );
}
