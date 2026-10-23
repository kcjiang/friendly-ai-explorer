"use client";
import { useUiTranslations } from "@/i18n/client";

import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/base/card";
import { cn } from "@/lib/utils";

export type CardKind = "accounts" | "messages" | "automations";
type Frame = { children: ReactNode; className?: string };
const Frames = createContext<Map<string, Frame> | null>(null);
const identity = (kind: CardKind, id: string) => `${kind}:${id}`;

// Cross-column drops require a real hit; sorting within a list uses proximity.
const collisions: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind;
  const candidates = args.droppableContainers.filter(
    (c) =>
      (kind !== "messages" && c.data.current?.kind === kind) ||
      (kind === "messages" && c.data.current?.kind === "automations"),
  );
  const hit = pointerWithin({ ...args, droppableContainers: candidates });
  if (hit.length) return hit;
  // Keyboard sorting has no pointer coordinates. Mouse drops outside a list cancel.
  const same = candidates.filter(
    (c) => kind === "messages" || c.data.current?.kind === kind,
  );
  if (!args.pointerCoordinates)
    return closestCenter({ ...args, droppableContainers: same });
  const point = args.pointerCoordinates;
  const inList = same.some((c) => {
    const list = c.node.current
      ?.closest("[data-card-list]")
      ?.getBoundingClientRect();
    return (
      list &&
      point.x >= list.left &&
      point.x <= list.right &&
      point.y >= list.top &&
      point.y <= list.bottom
    );
  });
  return inList ? closestCenter({ ...args, droppableContainers: same }) : [];
};

export function WorkbenchDragCards({
  children,
  onMove,
  onSubmit,
  onDraggingChange,
}: {
  children: ReactNode;
  onMove: (kind: CardKind, source: string, target: string) => void;
  onSubmit: (messageId: string, automationId: string) => void;
  onDraggingChange: (active: boolean) => void;
}) {
  const t = useUiTranslations();

  const frames = useRef(new Map<string, Frame>());
  const [preview, setPreview] = useState<Frame | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 240, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function finish() {
    setPreview(null);
    onDraggingChange(false);
  }
  return (
    <Frames.Provider value={frames.current}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisions}
        accessibility={{
          screenReaderInstructions: {
            draggable: t("ui.pressSpaceToPickUpACardArrowKeysToMoveSpace"),
          },
          announcements: {
            onDragStart: () => t("ui.cardPickedUpUseArrowKeysToMove"),
            onDragOver: ({ over }) =>
              over ? t("ui.dropTargetAvailable") : t("ui.outsideTheDropArea"),
            onDragEnd: ({ over }) =>
              over ? t("ui.cardDropped") : t("ui.moveCancelled"),
            onDragCancel: () =>
              t("ui.moveCancelledCardRestoredToItsOriginalPosition"),
          },
        }}
        onDragStart={({ active }) => {
          setPreview(frames.current.get(String(active.id)) ?? null);
          onDraggingChange(true);
        }}
        onDragCancel={finish}
        onDragEnd={({ active, over }) => {
          finish();
          if (!over) return;
          const source = active.data.current,
            target = over.data.current;
          if (!source || !target) return;
          if (
            source.kind !== "messages" &&
            source.kind === target.kind &&
            source.id !== target.id
          )
            onMove(source.kind, source.id, target.id);
          else if (source.kind === "messages" && target.kind === "automations")
            onSubmit(source.id, target.id);
        }}
      >
        {children}
        {mounted &&
          createPortal(
            <DragOverlay
              zIndex={80}
              adjustScale={false}
              dropAnimation={{
                duration: 220,
                easing: "cubic-bezier(.2,.8,.2,1)",
                sideEffects: defaultDropAnimationSideEffects({
                  styles: { active: { opacity: "0" } },
                }),
              }}
            >
              {preview && (
                <Card
                  aria-hidden="true"
                  inert
                  data-workbench-drag-preview
                  className={cn(
                    preview.className,
                    "ring-primary/25 pointer-events-none scale-[1.025] rotate-[1deg] cursor-default shadow-2xl ring-2",
                  )}
                >
                  {preview.children}
                </Card>
              )}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </Frames.Provider>
  );
}

export function CardList({
  kind,
  ids,
  children,
  className,
}: {
  kind: CardKind;
  ids: string[];
  children: ReactNode;
  className?: string;
}) {
  if (kind === "messages")
    return (
      <div data-card-list={kind} className={className}>
        {children}
      </div>
    );
  return (
    <SortableContext
      items={ids.map((id) => identity(kind, id))}
      strategy={
        kind === "accounts" ? rectSortingStrategy : verticalListSortingStrategy
      }
    >
      <div data-card-list={kind} className={className}>
        {children}
      </div>
    </SortableContext>
  );
}

type DragCardProps = ComponentProps<typeof Card> & {
  kind: CardKind;
  cardId: string;
  disabled?: boolean;
};

export function DragCard(props: DragCardProps) {
  return props.kind === "messages" ? (
    <MessageDragCard {...props} />
  ) : (
    <SortableCard {...props} />
  );
}

function MessageDragCard(props: DragCardProps) {
  const drag = useDraggable({
    id: identity(props.kind, props.cardId),
    data: { kind: props.kind, id: props.cardId },
    disabled: props.disabled,
  });
  return (
    <CardFrame
      {...props}
      drag={{ ...drag, isOver: false, active: null, transition: undefined }}
    />
  );
}

function SortableCard(props: DragCardProps) {
  const drag = useSortable({
    id: identity(props.kind, props.cardId),
    data: { kind: props.kind, id: props.cardId },
    disabled: props.disabled,
    transition: { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
  });
  return <CardFrame {...props} drag={drag} />;
}

function CardFrame({
  kind,
  cardId,
  disabled,
  children,
  className,
  onKeyDown,
  drag,
  ...props
}: DragCardProps & {
  drag: Pick<
    ReturnType<typeof useSortable>,
    | "attributes"
    | "listeners"
    | "setNodeRef"
    | "transform"
    | "transition"
    | "isDragging"
    | "isOver"
    | "active"
  >;
}) {
  const frames = useContext(Frames)!;
  const id = identity(kind, cardId);
  useEffect(() => {
    frames.set(id, { children, className });
    return () => {
      frames.delete(id);
    };
  }, [frames, id, children, className]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = drag;
  const interactive = (target: EventTarget | null) => {
    const element = (target as HTMLElement)?.closest(
      'button,a,input,textarea,select,[role="combobox"]',
    );
    return element && !element.hasAttribute("data-card-drag-surface");
  };
  return (
    <Card
      ref={setNodeRef}
      {...attributes}
      {...props}
      role="group"
      data-card-id={cardId}
      data-card-kind={kind}
      {...listeners}
      onMouseDown={(e) => {
        if (!disabled && !interactive(e.target)) listeners?.onMouseDown?.(e);
      }}
      onTouchStart={(e) => {
        if (!disabled && !interactive(e.target)) listeners?.onTouchStart?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && e.target === e.currentTarget)
          listeners?.onKeyDown?.(e);
      }}
      style={{
        ...props.style,
        transform:
          kind === "messages" ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity: isDragging ? 0 : undefined,
      }}
      className={cn(
        className,
        "focus-visible:ring-ring cursor-default select-none focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
        isOver &&
          active?.data.current?.kind === "messages" &&
          kind === "automations" &&
          "ring-primary bg-muted ring-2",
      )}
    >
      {children}
    </Card>
  );
}
