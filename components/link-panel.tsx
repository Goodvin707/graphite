"use client"

import { Button } from "@/components/ui/button"
import { describeLinks, type Note } from "@/lib/model"
import type { ReactNode } from "react"

type LinkPanelProps = {
  note: Note | null
  notes: Note[]
  onOpen: (id: string) => void
  onCreate: (title: string) => void
  onLinkify: (noteId: string) => void
  onTag: (tag: string) => void
}

export function LinkPanel({ note, notes, onOpen, onCreate, onLinkify, onTag }: LinkPanelProps) {
  if (!note) {
    return <div className="p-4 text-sm text-muted-foreground">Откройте заметку, чтобы увидеть входящие и исходящие связи.</div>
  }
  const info = describeLinks(notes, note)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="px-4 py-3">
        <div className="text-xs tracking-wide text-muted-foreground uppercase">Связи</div>
        <div className="mt-1 font-serif text-lg leading-tight">{note.title}</div>
      </div>
      <Section title="Исходящие" count={info.outgoing.length}>
        {info.outgoing.length === 0 && <Empty>В тексте нет [[ссылок]].</Empty>}
        {info.outgoing.map((link) => (
          <div key={link.title} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => (link.noteId ? onOpen(link.noteId) : onCreate(link.title))}
            >
              <span className={link.missing ? "border-b border-dashed text-muted-foreground" : ""}>{link.title}</span>
              {link.missing && <span className="ml-2 text-[11px] text-muted-foreground">создать</span>}
            </button>
            {link.excerpt && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{link.excerpt}</p>}
          </div>
        ))}
      </Section>
      <Section title="Входящие" count={info.incoming.length}>
        {info.incoming.length === 0 && <Empty>На эту заметку пока никто не ссылается.</Empty>}
        {info.incoming.map((link) => (
          <button key={link.noteId} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5" onClick={() => onOpen(link.noteId)}>
            <span className="block text-sm">{link.title}</span>
            {link.excerpt && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{link.excerpt}</span>}
          </button>
        ))}
      </Section>
      <Section title="Упоминания без ссылки" count={info.mentions.length}>
        {info.mentions.length === 0 && <Empty>Голое имя этой заметки в других текстах не встречается.</Empty>}
        {info.mentions.map((link) => (
          <div key={link.noteId} className="rounded-lg px-2 py-1.5 hover:bg-white/5">
            <button type="button" className="block w-full text-left" onClick={() => onOpen(link.noteId)}>
              <span className="block text-sm">{link.title}</span>
              {link.excerpt && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{link.excerpt}</span>}
            </button>
            <Button size="xs" variant="ghost" className="mt-1" onClick={() => onLinkify(link.noteId)}>
              Сделать ссылкой
            </Button>
          </div>
        ))}
      </Section>
      <Section title="Теги" count={info.tags.length}>
        {info.tags.length === 0 && <Empty>Тегов нет. Добавьте #тему в текст.</Empty>}
        <div className="flex flex-wrap gap-1 px-2">
          {info.tags.map((tag) => (
            <button key={tag} type="button" className="rounded-full bg-white/8 px-2 py-0.5 text-xs ring-1 ring-white/10" onClick={() => onTag(tag)}>
              #{tag}
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="border-t border-white/8 px-2 py-3">
      <div className="mb-1 flex items-baseline justify-between px-2">
        <h2 className="text-xs tracking-wide text-muted-foreground uppercase">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
}
