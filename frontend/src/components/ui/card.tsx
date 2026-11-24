import * as React from "react"
import { cn } from "cn"

interface CardProps extends Omit<React.ComponentProps<"div">, "title"> {
  size?: "default" | "sm"
  title?: React.ReactNode
  action?: React.ReactNode
}

function Card({
  className,
  size = "default",
  title,
  action,
  children,
  ...props
}: CardProps) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] data-[size=sm]:[--card-spacing:--spacing(3)]",
        title || action ? "py-0" : "py-(--card-spacing)",
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-(--card-spacing) py-3 bg-muted/20">
          {typeof title === "string" ? (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      {title || action ? (
        <div className="p-(--card-spacing) pt-3">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
