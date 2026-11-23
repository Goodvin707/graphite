"use client"

import { Button } from "@/components/ui/button"
import { colorForFolder, folderLabel, relativeTime, type Note } from "@/lib/model"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

type NoteSidebarProps = {
  notes: Note[]
  activeId: string | null
  query: string
  degrees: Map<string, number>
  onOpen: (id: string) => void
  onCreate: () => void
}

export function NoteSidebar({ notes, activeId, query, degrees, onOpen, onCreate }: NoteSidebarProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? notes.filter((note) =>
          [note.title, note.folder, note.content].some((value) => value.toLowerCase().includes(needle)),
        )
      : notes
    const buckets = new Map<string, Note[]>()
    for (const note of filtered) {
      const list = buckets.get(note.folder) ?? []
      list.push(note)
      buckets.set(note.folder, list)
    }
    return [...buckets.entries()]
      .sort((a, b) => folderLabel(a[0]).localeCompare(folderLabel(b[0]), "ru"))
      .map(([folder, items]) => ({
        folder,
        items: items.sort((a, b) => b.updatedAt - a.updatedAt),
      }))
  }, [notes, query])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div>
          <div className="text-xs tracking-wide text-muted-foreground uppercase">Заметки</div>
          <div className="text-sm">{notes.length}</div>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus />
          Новая
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {groups.length === 0 && (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            {notes.length === 0 ? "Пока пусто. Создайте первую заметку или откройте пример." : "Ничего не нашлось."}
          </div>
        )}
        {groups.map((group) => {
          const closed = collapsed.includes(group.folder)
          return (
            <section key={group.folder || "none"} className="mb-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5"
                onClick={() =>
                  setCollapsed((current) =>
                    current.includes(group.folder) ? current.filter((item) => item !== group.folder) : [...current, group.folder],
                  )
                }
              >
                <span className="size-2 rounded-full" style={{ background: colorForFolder(group.folder) }} />
                <span className="flex-1 truncate">{folderLabel(group.folder)}</span>
                <span>{group.items.length}</span>
              </button>
              {!closed &&
                group.items.map((note) => {
                  const active = note.id === activeId
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onOpen(note.id)}
                      className={`mb-0.5 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                    >
                      <span className="mt-1 size-1.5 shrink-0 rounded-full" style={{ background: colorForFolder(note.folder) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{note.title}</span>
                        <span className="block text-[11px] text-muted-foreground">{relativeTime(note.updatedAt)}</span>
                      </span>
                      <span className="pt-0.5 text-[11px] text-muted-foreground">{degrees.get(note.id) ?? 0}</span>
                    </button>
                  )
                })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
