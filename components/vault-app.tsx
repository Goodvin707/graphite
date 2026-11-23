"use client"

import { GraphCanvas } from "@/components/graph-canvas"
import { LinkPanel } from "@/components/link-panel"
import { NoteEditor } from "@/components/note-editor"
import { NoteSidebar } from "@/components/note-sidebar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  commitSettings,
  commitVault,
  dismissIntro,
  freshEmpty,
  freshSample,
  getIntroDismissed,
  getServerSettings,
  getServerVault,
  getSettings,
  getVault,
  subscribeIntro,
  subscribeSettings,
  subscribeVault,
} from "@/lib/browser-store"
import {
  buildGraph,
  createId,
  DEFAULT_GRAPH_SETTINGS,
  linkifyFirstMention,
  rewriteWikilinks,
  saveVault,
  searchNotes,
  sanitizeVault,
  validateFolder,
  validateTitle,
  vaultExists,
  type Note,
  type Vault,
} from "@/lib/model"
import { Download, Ellipsis, FileText, Menu, Network, Search, Upload, Waypoints } from "lucide-react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

type View = "note" | "graph"
type EditorMode = "edit" | "split" | "read"
type ConfirmState = { title: string; body: string; confirm: string; run: () => void }

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFilename(name: string) {
  return name.replace(/[^\p{L}\p{N}\-_ ]+/gu, "").trim().slice(0, 80) || "zametka"
}

const EMPTY_NOTES: Note[] = []

export function VaultApp() {
  const vault = useSyncExternalStore(subscribeVault, getVault, getServerVault)
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getServerSettings)
  const introDismissed = useSyncExternalStore(subscribeIntro, getIntroDismissed, () => true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [view, setView] = useState<View>("graph")
  const [mode, setMode] = useState<EditorMode>("split")
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchIndex, setSearchIndex] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftFolder, setDraftFolder] = useState("")
  const [helpOpen, setHelpOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [pendingImport, setPendingImport] = useState<Vault | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastId = useRef(0)

  useEffect(() => {
    if (!vault || vaultExists()) return
    saveVault(vault)
  }, [vault])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      const key = event.key.toLowerCase()
      if (key === "k") {
        event.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      } else if (key === "n") {
        event.preventDefault()
        setDraftTitle("")
        setDraftFolder("")
        setCreateOpen(true)
      } else if (key === "g" && event.shiftKey) {
        event.preventDefault()
        setView((current) => (current === "graph" ? "note" : "graph"))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const notify = (message: string) => {
    const id = ++toastId.current
    setToast(message)
    window.setTimeout(() => {
      if (toastId.current === id) setToast(null)
    }, 3200)
  }

  const notes = vault?.notes ?? EMPTY_NOTES
  const resolvedId = notes.some((note) => note.id === activeId)
    ? activeId
    : (notes.find((note) => note.title === "Карта мастерской")?.id ?? notes[0]?.id ?? null)
  const active = notes.find((note) => note.id === resolvedId) ?? null
  const intro = vault?.origin === "sample" && !introDismissed
  const results = useMemo(() => searchNotes(notes, query), [notes, query])
  const degrees = useMemo(() => {
    const graph = buildGraph(notes, { ...DEFAULT_GRAPH_SETTINGS, showGhosts: false, showTagNodes: false })
    return new Map(graph.nodes.filter((node) => node.noteId).map((node) => [node.noteId as string, node.realDegree]))
  }, [notes])

  const updateNotes = (nextNotes: Note[], origin?: Vault["origin"]) => {
    if (!vault) return
    commitVault({
      ...vault,
      origin: origin ?? (vault.origin === "empty" ? "user" : vault.origin),
      notes: nextNotes,
    })
  }

  const openNote = (id: string) => {
    setActiveId(id)
    setView("note")
    setNavOpen(false)
    setLinksOpen(false)
    setSearchOpen(false)
  }

  const createNote = (title: string, folder = "", content = "") => {
    if (!vault) return null
    const error = validateTitle(title) || validateFolder(folder)
    if (error) {
      notify(error)
      return null
    }
    const clean = title.trim()
    const existing = vault.notes.find((note) => note.title.toLowerCase() === clean.toLowerCase())
    if (existing) {
      openNote(existing.id)
      notify("Такая заметка уже есть")
      return existing
    }
    const note: Note = {
      id: createId(),
      title: clean,
      folder: folder.trim(),
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    updateNotes([note, ...vault.notes])
    openNote(note.id)
    return note
  }

  const renameNote = (title: string) => {
    if (!vault || !active) return false
    const error = validateTitle(title)
    if (error) {
      notify(error)
      return false
    }
    const clean = title.trim()
    if (vault.notes.some((note) => note.id !== active.id && note.title.toLowerCase() === clean.toLowerCase())) {
      notify("Такое название уже есть")
      return false
    }
    updateNotes(
      vault.notes.map((note) =>
        note.id === active.id
          ? { ...note, title: clean, updatedAt: Date.now() }
          : { ...note, content: rewriteWikilinks(note.content, active.title, clean) },
      ),
    )
    notify("Ссылки на новое название обновлены")
    return true
  }

  const changeFolder = (folder: string) => {
    if (!vault || !active) return false
    const error = validateFolder(folder)
    if (error) {
      notify(error)
      return false
    }
    updateNotes(vault.notes.map((note) => (note.id === active.id ? { ...note, folder, updatedAt: Date.now() } : note)))
    return true
  }

  const changeContent = (content: string) => {
    if (!vault || !active) return
    updateNotes(
      vault.notes.map((note) => (note.id === active.id ? { ...note, content, updatedAt: Date.now() } : note)),
    )
  }

  const removeNote = () => {
    if (!vault || !active) return
    const removed = active.title
    const rest = vault.notes.filter((note) => note.id !== active.id)
    updateNotes(rest)
    setActiveId(rest[0]?.id ?? null)
    notify(`«${removed}» удалена`)
  }

  const linkify = (noteId: string) => {
    if (!vault || !active) return
    const source = vault.notes.find((note) => note.id === noteId)
    if (!source) return
    const result = linkifyFirstMention(source.content, active.title)
    if (!result.changed) {
      notify("Не нашёл упоминания вне ссылки и кода")
      return
    }
    updateNotes(vault.notes.map((note) => (note.id === source.id ? { ...note, content: result.content, updatedAt: Date.now() } : note)))
    notify(`В «${source.title}» появилась ссылка`)
  }

  const replaceVault = (next: Vault, message: string) => {
    commitVault(next)
    const home = next.notes.find((note) => note.title === "Карта мастерской") ?? next.notes[0]
    setActiveId(home?.id ?? null)
    setView("graph")
    notify(message)
  }

  const sidebar = vault ? (
    <NoteSidebar
      notes={vault.notes}
      activeId={activeId}
      query={query}
      degrees={degrees}
      onOpen={openNote}
      onCreate={() => {
        setDraftTitle("")
        setDraftFolder("")
        setCreateOpen(true)
        setNavOpen(false)
      }}
    />
  ) : null

  const links = (
    <LinkPanel
      note={active}
      notes={notes}
      onOpen={openNote}
      onCreate={(title) => createNote(title, active?.folder ?? "")}
      onLinkify={linkify}
      onTag={(tag) => {
        commitSettings({ ...settings, tags: [tag], mode: "global" })
        setView("graph")
        setLinksOpen(false)
      }}
    />
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/8 px-2 sm:px-3">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Список заметок">
          <Menu />
        </Button>
        <button type="button" className="flex items-center gap-2 px-1" onClick={() => setView("graph")}>
          <Mark className="size-7 text-[#f3efe4]" />
          <span className="hidden text-left sm:block">
            <span className="block font-serif text-base leading-none">Нить</span>
            <span className="block text-[11px] text-muted-foreground">{vault?.name || "хранилище"}</span>
          </span>
        </button>
        <div className="relative mx-auto w-full max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            placeholder="Поиск по заметкам"
            className="pl-8"
            aria-label="Поиск"
            aria-expanded={searchOpen}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchOpen(true)
              setSearchIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false)
                event.currentTarget.blur()
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setSearchIndex((index) => Math.min(results.length - 1, index + 1))
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setSearchIndex((index) => Math.max(0, index - 1))
              }
              if (event.key === "Enter" && results[searchIndex]) {
                event.preventDefault()
                openNote(results[searchIndex].note.id)
              }
            }}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
          />
          {searchOpen && query.trim() && (
            <div className="absolute top-10 z-30 w-full overflow-hidden rounded-lg bg-popover shadow-xl ring-1 ring-foreground/10">
              {results.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Ничего не нашлось</div>}
              {results.map((result, index) => (
                <button
                  key={result.note.id}
                  type="button"
                  className={`block w-full px-3 py-2 text-left ${index === searchIndex ? "bg-muted" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    openNote(result.note.id)
                  }}
                >
                  <span className="block text-sm">{result.note.title}</span>
                  <span className="line-clamp-1 block text-xs text-muted-foreground">{result.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden rounded-lg bg-white/5 p-0.5 sm:flex">
            <Button size="sm" variant={view === "note" ? "secondary" : "ghost"} onClick={() => setView("note")}>
              <FileText />
              Заметка
            </Button>
            <Button size="sm" variant={view === "graph" ? "secondary" : "ghost"} onClick={() => setView("graph")}>
              <Waypoints />
              Граф
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted" aria-label="Меню хранилища">
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => { setDraftTitle(""); setDraftFolder(""); setCreateOpen(true) }}>Новая заметка</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (!active) return
                  download(`${safeFilename(active.title)}.md`, active.content, "text/markdown")
                }}
              >
                Скачать эту заметку
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => vault && download(`${safeFilename(vault.name)}.json`, JSON.stringify(vault, null, 2), "application/json")}>
                <Download />
                Экспорт хранилища
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                <Upload />
                Импорт JSON
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  setConfirm({
                    title: "Вернуть пример?",
                    body: "Текущие заметки в этом браузере будут заменены хранилищем «Мастерская».",
                    confirm: "Вернуть",
                    run: () => replaceVault(freshSample(), "Снова открыт пример"),
                  })
                }
              >
                Пример «Мастерская»
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setConfirm({
                    title: "Очистить хранилище?",
                    body: "Все заметки будут удалены из этого браузера. Экспортируйте JSON, если они нужны.",
                    confirm: "Очистить",
                    run: () => replaceVault(freshEmpty(), "Хранилище пустое"),
                  })
                }
              >
                Пустое хранилище
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setHelpOpen(true)}>Клавиши и приёмы</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {intro && (
        <div className="flex items-start justify-between gap-3 border-b border-white/8 bg-[#2a2418] px-4 py-2 text-sm text-[#f3ead8]">
          <p>Это пример «Мастерская». Заметки живут только в этом браузере. Дважды щёлкните узел, чтобы открыть текст.</p>
          <button
            type="button"
            className="shrink-0 underline"
            onClick={dismissIntro}
          >
            Скрыть
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-white/8 md:block">{sidebar}</aside>
        <main className="min-w-0 flex-1">
          {!vault ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Открываю хранилище…</div>
          ) : view === "graph" ? (
            <GraphCanvas
              notes={vault.notes}
              focusId={resolvedId}
              query={query}
              settings={settings}
              onSettings={commitSettings}
              onOpenNote={openNote}
              onCreateNote={(title) => createNote(title)}
              onFocusNote={(id) => {
                setActiveId(id)
                commitSettings({ ...settings, mode: "local" })
              }}
            />
          ) : active ? (
            <NoteEditor
              key={active.id}
              note={active}
              notes={vault.notes}
              mode={mode}
              onMode={setMode}
              onContent={changeContent}
              onRename={renameNote}
              onFolder={changeFolder}
              onDelete={() =>
                setConfirm({
                  title: `Удалить «${active.title}»?`,
                  body: "Ссылки на неё останутся в других заметках и станут призраками на графе.",
                  confirm: "Удалить",
                  run: removeNote,
                })
              }
              onOpenWiki={(title, missing) => {
                const found = vault.notes.find((note) => note.title.toLowerCase() === title.toLowerCase())
                if (found) openNote(found.id)
                else if (missing) createNote(title, active.folder)
              }}
              onOpenTag={(tag) => {
                commitSettings({ ...settings, tags: [tag], mode: "global" })
                setView("graph")
              }}
              onShowGraph={() => {
                commitSettings({ ...settings, mode: "local" })
                setView("graph")
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Network className="size-8 text-[#e0a45a]" />
              <div className="font-serif text-2xl">Пока нет открытой заметки</div>
              <p className="max-w-sm text-sm text-muted-foreground">Создайте первую или верните пример, чтобы увидеть, как ссылки собираются в граф.</p>
              <div className="flex gap-2">
                <Button onClick={() => setCreateOpen(true)}>Новая заметка</Button>
                <Button variant="outline" onClick={() => replaceVault(freshSample(), "Открыт пример")}>
                  Открыть пример
                </Button>
              </div>
            </div>
          )}
        </main>
        <aside className="hidden w-80 shrink-0 border-l border-white/8 xl:block">{view === "note" ? links : null}</aside>
      </div>

      <nav className="grid h-14 shrink-0 grid-cols-4 border-t border-white/8 sm:hidden">
        <button type="button" className="text-xs" onClick={() => setNavOpen(true)}>Список</button>
        <button type="button" className={view === "note" ? "text-[#e0a45a]" : "text-xs"} onClick={() => setView("note")}>Заметка</button>
        <button type="button" className={view === "graph" ? "text-[#e0a45a]" : "text-xs"} onClick={() => setView("graph")}>Граф</button>
        <button type="button" className="text-xs" onClick={() => setLinksOpen(true)}>Связи</button>
      </nav>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Заметки</SheetTitle>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>
      <Sheet open={linksOpen} onOpenChange={setLinksOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Связи</SheetTitle>
          </SheetHeader>
          {links}
        </SheetContent>
      </Sheet>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая заметка</DialogTitle>
            <DialogDescription>Название станет целью для [[ссылок]].</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const created = createNote(draftTitle, draftFolder)
              if (created) setCreateOpen(false)
            }}
          >
            <Input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Например, Микориза" aria-label="Название" />
            <Input value={draftFolder} onChange={(event) => setDraftFolder(event.target.value)} placeholder="Папка, можно новую" aria-label="Папка" list="nit-folders" />
            <DialogFooter>
              <Button type="submit">Создать</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Как устроена Нить</DialogTitle>
            <DialogDescription>Локальные заметки. Граф строится из [[ссылок]].</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            <li>Ctrl или ⌘ K — поиск, N — новая заметка, Shift G — граф или текст.</li>
            <li>Двойной щелчок по узлу открывает заметку. Колесо приближает.</li>
            <li>Пустой кружок — призрак: ссылка есть, заметки ещё нет.</li>
            <li>Сирота ни с кем не связана. На графе её можно скрыть.</li>
            <li>Перетащенный узел остаётся на месте, пока его не отпустят.</li>
            <li>Данные лежат в этом браузере. Для переноса есть экспорт JSON.</li>
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Отмена</Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirm?.run()
                setConfirm(null)
              }}
            >
              {confirm?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingImport} onOpenChange={(open) => !open && setPendingImport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заменить хранилище?</DialogTitle>
            <DialogDescription>
              В файле {pendingImport?.notes.length ?? 0} заметок. То, что сейчас открыто в этом браузере, будет заменено.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingImport(null)}>Отмена</Button>
            <Button
              onClick={() => {
                if (pendingImport) replaceVault({ ...pendingImport, origin: "import" }, `Импортировано заметок: ${pendingImport.notes.length}`)
                setPendingImport(null)
              }}
            >
              Заменить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          if (file.size > 8_000_000) {
            notify("Файл слишком большой")
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            try {
              const parsed = sanitizeVault(JSON.parse(String(reader.result)))
              if (!parsed) {
                notify("Не похоже на хранилище Нити")
                return
              }
              setPendingImport(parsed)
            } catch {
              notify("Файл не читается")
            }
          }
          reader.readAsText(file)
        }}
      />

      {toast && (
        <div className="fixed bottom-16 left-1/2 z-50 max-w-sm -translate-x-1/2 rounded-full bg-[#f3efe4] px-3 py-1.5 text-center text-sm text-[#1c2118] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="8" cy="17" r="3.1" fill="#8fbf6a" />
      <circle cx="24" cy="8" r="3.1" fill="#e0a45a" />
      <circle cx="23" cy="24" r="3.1" fill="#6eb0d4" />
      <path d="M10.6 15.6c3.2-1.2 6.2-5.2 10.2-6.4M11 18.2c3.4.7 6.2 3.6 8.8 5" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  )
}
