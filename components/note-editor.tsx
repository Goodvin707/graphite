"use client"

import { MarkdownView } from "@/components/markdown-view"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { relativeTime, validateFolder, validateTitle, type Note } from "@/lib/model"
import { Network, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"

type EditorMode = "edit" | "split" | "read"

type NoteEditorProps = {
  note: Note
  notes: Note[]
  mode: EditorMode
  onMode: (mode: EditorMode) => void
  onContent: (content: string) => void
  onRename: (title: string) => boolean
  onFolder: (folder: string) => boolean
  onDelete: () => void
  onOpenWiki: (title: string, missing: boolean) => void
  onOpenTag: (tag: string) => void
  onShowGraph: () => void
}

function wikiAtCursor(text: string, cursor: number) {
  const before = text.slice(0, cursor)
  const start = before.lastIndexOf("[[")
  if (start < 0) return null
  const chunk = before.slice(start + 2)
  if (chunk.includes("]]") || chunk.includes("\n") || chunk.includes("|")) return null
  return { start, query: chunk.trim().toLowerCase() }
}

export function NoteEditor({
  note,
  notes,
  mode,
  onMode,
  onContent,
  onRename,
  onFolder,
  onDelete,
  onOpenWiki,
  onOpenTag,
  onShowGraph,
}: NoteEditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [title, setTitle] = useState(note.title)
  const [folder, setFolder] = useState(note.folder)
  const [cursor, setCursor] = useState(0)
  const folders = useMemo(() => [...new Set(notes.map((item) => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [notes])

  const query = wikiAtCursor(note.content, cursor)
  const suggestions = query
    ? notes
        .filter((item) => item.id !== note.id && item.title.toLowerCase().includes(query.query))
        .slice(0, 6)
    : []

  const insertTitle = (nextTitle: string) => {
    const area = areaRef.current
    const caret = area?.selectionStart ?? cursor
    const open = wikiAtCursor(note.content, caret)
    let next = note.content
    let place = caret
    if (open) {
      next = `${note.content.slice(0, open.start)}[[${nextTitle}]]${note.content.slice(caret)}`
      place = open.start + nextTitle.length + 4
    } else {
      const chunk = `[[${nextTitle}]]`
      const end = area?.selectionEnd ?? caret
      next = `${note.content.slice(0, caret)}${chunk}${note.content.slice(end)}`
      place = caret + chunk.length
    }
    onContent(next)
    setCursor(place)
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(place, place)
    })
  }

  const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-white/8 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="min-w-0 w-full flex-1">
          <input
            id={`title-${note.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title.trim() === note.title) return
              if (validateTitle(title) || !onRename(title)) setTitle(note.title)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            className="w-full bg-transparent font-serif text-2xl leading-tight outline-none"
            aria-label="Название заметки"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <input
              id={`folder-${note.id}`}
              value={folder}
              list="nit-folders"
              onChange={(event) => setFolder(event.target.value)}
              onBlur={() => {
                if (folder.trim() === note.folder) return
                if (validateFolder(folder) || !onFolder(folder.trim())) setFolder(note.folder)
              }}
              placeholder="Без папки"
              className="w-40 bg-transparent outline-none placeholder:text-muted-foreground"
              aria-label="Папка"
            />
            <datalist id="nit-folders">
              {folders.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <span>{relativeTime(note.updatedAt)}</span>
            <span>{words} сл.</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["edit", "Правка"],
              ["split", "Оба"],
              ["read", "Чтение"],
            ] as const
          ).map(([value, label]) => (
            <Button key={value} size="sm" variant={mode === value ? "secondary" : "ghost"} onClick={() => onMode(value)}>
              {label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={onShowGraph}>
            <Network />
            На графе
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Удалить заметку">
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className={mode === "split" ? "grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "flex min-h-0 flex-1 flex-col"}>
        {mode !== "read" && (
          <div className="relative min-h-0">
            <Textarea
              ref={areaRef}
              value={note.content}
              onChange={(event) => {
                onContent(event.target.value)
                setCursor(event.target.selectionStart ?? 0)
              }}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
              onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
              onClick={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
              placeholder="Пишите своими словами. Ссылка — [[Название]], тег — #тема."
              className="field-sizing-fixed h-full min-h-0 resize-none rounded-none border-0 bg-transparent px-4 py-4 text-[15px] leading-7 shadow-none focus-visible:ring-0 md:text-[15px]"
              spellCheck
            />
            {suggestions.length > 0 && (
              <div className="absolute bottom-3 left-4 z-10 w-72 overflow-hidden rounded-lg bg-popover shadow-xl ring-1 ring-foreground/10">
                {suggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      insertTitle(item.title)
                    }}
                  >
                    {item.title}
                    <span className="ml-2 text-xs text-muted-foreground">{item.folder || "без папки"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {mode !== "edit" && (
          <div className={`min-h-0 overflow-auto px-5 py-4 ${mode === "split" ? "border-t border-white/8 md:border-t-0 md:border-l" : ""}`}>
            {note.content.trim() ? (
              <MarkdownView content={note.content} notes={notes} onOpenWiki={onOpenWiki} onOpenTag={onOpenTag} />
            ) : (
              <p className="text-sm text-muted-foreground">В режиме чтения здесь появится текст.</p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/8 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>[[ссылка]] связывает заметки · #тег собирает тему</span>
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => {
            const area = areaRef.current
            const caret = area?.selectionStart ?? note.content.length
            const end = area?.selectionEnd ?? caret
            const next = `${note.content.slice(0, caret)}[[${note.content.slice(end)}`
            onContent(next)
            const place = caret + 2
            setCursor(place)
            requestAnimationFrame(() => {
              area?.focus()
              area?.setSelectionRange(place, place)
            })
          }}
        >
          Вставить [[ссылку]]
        </button>
      </div>
    </div>
  )
}
