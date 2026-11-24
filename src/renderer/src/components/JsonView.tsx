import { useState } from 'react'

interface JsonViewProps {
  value: unknown
  /** 默认展开的层级深度 */
  defaultDepth?: number
  /** 传入 true 时所有节点初始展开（父组件通过 key 重挂载生效） */
  expandAll?: boolean
}

interface JsonNodeProps {
  value: unknown
  name?: string
  index?: string
  depth: number
  isLast: boolean
  expandAll: boolean
  defaultDepth: number
}

const INDENT = 14

function primitiveClass(value: unknown): string {
  if (value === null || value === undefined) return 'json-null'
  switch (typeof value) {
    case 'string':
      return 'json-string'
    case 'number':
      return 'json-number'
    case 'boolean':
      return 'json-boolean'
    default:
      return 'json-null'
  }
}

function primitiveText(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null || value === undefined) return 'null'
  return String(value)
}

function KeyLabel({ name, index }: { name?: string; index?: string }) {
  if (index !== undefined) {
    return (
      <>
        <span className="json-index">{index}</span>
        <span className="json-punct">: </span>
      </>
    )
  }
  if (name === undefined) return null
  return (
    <>
      <span className="json-key">{JSON.stringify(name)}</span>
      <span className="json-punct">: </span>
    </>
  )
}

function JsonNode({
  value,
  name,
  index,
  depth,
  isLast,
  expandAll,
  defaultDepth
}: JsonNodeProps) {
  const [expanded, setExpanded] = useState(() => expandAll || depth < defaultDepth)

  if (value === null || typeof value !== 'object') {
    return (
      <div className="json-line" style={{ paddingLeft: depth * INDENT }}>
        <span className="json-caret json-caret-placeholder" />
        <KeyLabel name={name} index={index} />
        <span className={primitiveClass(value)}>{primitiveText(value)}</span>
        {!isLast ? <span className="json-punct">,</span> : null}
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((child, itemIndex) => [String(itemIndex), child])
    : Object.entries(value as Record<string, unknown>)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'

  return (
    <div className="json-block">
      <div className="json-line" style={{ paddingLeft: depth * INDENT }}>
        <button
          type="button"
          className="json-caret"
          aria-label={expanded ? '折叠' : '展开'}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <KeyLabel name={name} index={index} />
        <span className="json-punct">{open}</span>
        {!expanded ? (
          <>
            <span className="json-collapsed">
              … {entries.length} {isArray ? '项' : '个字段'}
            </span>
            <span className="json-punct">
              {close}
              {!isLast ? ',' : ''}
            </span>
          </>
        ) : null}
      </div>

      {expanded ? (
        <>
          {entries.map(([key, child], itemIndex) => (
            <JsonNode
              key={key}
              value={child}
              name={isArray ? undefined : key}
              index={isArray ? key : undefined}
              depth={depth + 1}
              isLast={itemIndex === entries.length - 1}
              expandAll={expandAll}
              defaultDepth={defaultDepth}
            />
          ))}
          <div className="json-line" style={{ paddingLeft: depth * INDENT }}>
            <span className="json-caret json-caret-placeholder" />
            <span className="json-punct">
              {close}
              {!isLast ? ',' : ''}
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function JsonView({ value, defaultDepth = 2, expandAll = false }: JsonViewProps) {
  return (
    <div className="json-view mono">
      <JsonNode
        value={value}
        depth={0}
        isLast
        expandAll={expandAll}
        defaultDepth={defaultDepth}
      />
    </div>
  )
}
