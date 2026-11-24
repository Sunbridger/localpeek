import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { envValue } from './env'
import { registerIpc } from './ipc'
import type { DbManager } from './manager'
import { createWindow } from './window'

/** 开发期 UI 自检：LOCALPEEK_CAPTURE=/tmp/a.png LOCALPEEK_CAPTURE_TARGET=redis-value 启动后截图退出。 */
export async function runCapture(manager: DbManager): Promise<void> {
  const capturePath = envValue('CAPTURE')
  if (!capturePath) return
  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  registerIpc(manager)
  const window = createWindow(false)

  await new Promise<void>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve())
  })

  await delay(Number(envValue('CAPTURE_DELAY') ?? 9000))
  await drive(window, envValue('CAPTURE_TARGET') ?? 'home')
  await delay(1200)

  const image = await window.webContents.capturePage()
  writeFileSync(capturePath, image.toPNG())
  console.log('[localpeek:capture]', capturePath)
  app.quit()
}

async function drive(window: BrowserWindow, target: string): Promise<void> {
  const fixtures = {
    mysqlInstance: envValue('CAPTURE_MYSQL_INSTANCE') ?? 'demo-mysql',
    mysqlInstance2: envValue('CAPTURE_MYSQL_INSTANCE2') ?? 'demo-mysql-2',
    mysqlDatabase: envValue('CAPTURE_MYSQL_DATABASE') ?? 'demo',
    mysqlDatabase2: envValue('CAPTURE_MYSQL_DATABASE2') ?? 'demo',
    mysqlTable: envValue('CAPTURE_MYSQL_TABLE') ?? 'orders',
    mysqlTable2: envValue('CAPTURE_MYSQL_TABLE2') ?? 'events',
    mysqlTable3: envValue('CAPTURE_MYSQL_TABLE3') ?? 'pending',
    mysqlTable4: envValue('CAPTURE_MYSQL_TABLE4') ?? 'runs',
    mysqlTable5: envValue('CAPTURE_MYSQL_TABLE5') ?? 'releases',
    redisInstance: envValue('CAPTURE_REDIS_INSTANCE') ?? '本地 Redis',
    project: envValue('CAPTURE_PROJECT') ?? 'demo-project',
    demoMysql: envValue('CAPTURE_DEMO_MYSQL') ?? 'localpeek-demo-mysql',
    demoRedis: envValue('CAPTURE_DEMO_REDIS') ?? 'localpeek-demo-redis',
    demoDatabase: envValue('CAPTURE_DEMO_DATABASE') ?? 'demo_shop',
    demoTable: envValue('CAPTURE_DEMO_TABLE') ?? 'customers',
    demoPattern: envValue('CAPTURE_DEMO_REDIS_PATTERN') ?? 'localpeek:demo:*',
    demoProject: envValue('CAPTURE_DEMO_PROJECT') ?? 'localpeek-demo',
    demoProjectA: envValue('CAPTURE_DEMO_PROJECT_A') ?? 'alpha',
    demoProjectB: envValue('CAPTURE_DEMO_PROJECT_B') ?? 'beta',
    demoPorts: [5199, 5198]
  }
  const script = `(async () => {
    const F = ${JSON.stringify(fixtures)}
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const clickGroup = (text) => {
      const group = [...document.querySelectorAll('.tree-group')].find((el) => el.textContent && el.textContent.includes(text))
      if (!group) return false
      group.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    const expandGroup = (text) => {
      const node = [...document.querySelectorAll('.ant-tree-treenode')].find((n) => n.textContent && n.textContent.includes(text))
      const switcher = node && node.querySelector('.ant-tree-switcher')
      if (!switcher) return false
      switcher.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    const clickTree = (text) => {
      const node = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.includes(text))
      if (!node) return false
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    const clickWebPort = (text) => {
      const nodes = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].filter((n) => n.querySelector('.web-role-text'))
      const node = text ? nodes.find((n) => n.textContent && n.textContent.includes(text)) : nodes[0]
      if (!node) return false
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    const clickRow = (text) => {
      const row = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(text))
      if (!row) return false
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    const makeMouse = (type, x, y, buttons) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons, button: 0 })
      Object.defineProperty(e, 'pageX', { value: x })
      Object.defineProperty(e, 'pageY', { value: y })
      return e
    }
    const dragBarAsync = async (bar, dx, dy) => {
      if (!bar) return false
      const r = bar.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      bar.dispatchEvent(makeMouse('mousedown', x, y, 1))
      await sleep(250)
      document.dispatchEvent(makeMouse('mousemove', x + dx, y + dy, 1))
      await sleep(150)
      document.dispatchEvent(makeMouse('mouseup', x + dx, y + dy, 0))
      await sleep(300)
      return true
    }
    const setInputValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const hideSidebar = () => {
      const sidebarPanel = document.querySelector('.sidebar')?.closest('.ant-splitter-panel')
      if (sidebarPanel) sidebarPanel.style.display = 'none'
      document.querySelectorAll('.main-splitter .ant-splitter-bar').forEach((el) => {
        el.style.display = 'none'
      })
      const contentPanel = document.querySelector('.content')?.closest('.ant-splitter-panel')
      if (contentPanel) {
        contentPanel.style.flex = '1 1 auto'
        contentPanel.style.width = 'auto'
      }
    }
    const waitFor = async (fn, timeout = 15000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        const value = fn()
        if (value) return value
        await sleep(200)
      }
      return null
    }
    const dragBar = (bar, dx, dy) => {
      if (!bar) return false
      const r = bar.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, buttons: 1 }))
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y + dy, buttons: 1 }))
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y + dy }))
      return true
    }
    const result = {}
    if ('${target}' === 'mysql-rescan') {
      result.group = expandGroup('MySQL')
      await sleep(800)
      result.tree = clickTree(F.mysqlInstance)
      await sleep(1800)
      result.database = clickRow(F.mysqlDatabase)
      await sleep(1600)
      result.table = clickRow(F.mysqlTable)
      await sleep(2500)
      const rescan = [...document.querySelectorAll('.header-actions button')].find((b) => b.textContent && b.textContent.includes('重新扫描'))
      result.rescan = !!rescan
      if (rescan) rescan.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(9000)
      result.stillOnTable = document.body.textContent.includes(F.mysqlTable)
      result.hasRows = document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row').length
    } else if ('${target}' === 'web-multi') {
      clickGroup('Web 应用')
      await sleep(800)
      result.manage = clickWebPort(':8060')
      await sleep(1800)
      const findRow = () => [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':8060'))
      let row = findRow()
      result.rowText = row?.textContent?.slice(0, 140)
      result.processesAggregated = !!row && row.textContent.includes('共 2 个进程')
      const firstProjectCell = document.querySelector('.content .ant-table-tbody tr.ant-table-row td')
      result.rowSpan = firstProjectCell?.getAttribute('rowspan')
      const killButton = row && [...row.querySelectorAll('button')].find((b) => b.textContent && b.textContent.includes('关闭'))
      result.killButton = !!killButton
      if (killButton) killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(600)
      const confirmKill = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '关闭进程')
      result.confirmKill = !!confirmKill
      if (confirmKill) confirmKill.click()
      await sleep(3200)
      row = findRow()
      result.afterText = row?.textContent?.slice(0, 140)
      result.rowSpanAfter = document.querySelector('.content .ant-table-tbody tr.ant-table-row td')?.getAttribute('rowspan')
    } else if ('${target}' === 'tree-trigger') {
      result.group = clickGroup('MySQL')
      await sleep(800)
      const sidebarText = () => document.querySelector('.sidebar-scroll')?.textContent || ''
      result.instanceOpen1 = clickTree(F.mysqlInstance)
      await sleep(1300)
      result.dbVisible1 = sidebarText().includes(F.mysqlDatabase)
      clickTree(F.mysqlInstance)
      await sleep(600)
      result.dbVisible2 = sidebarText().includes(F.mysqlDatabase)
      clickTree(F.mysqlInstance)
      await sleep(900)
      result.dbVisible3 = sidebarText().includes(F.mysqlDatabase)
      const dbNode = () => [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlDatabase)
      if (dbNode()) dbNode().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1800)
      result.tablesVisible = sidebarText().includes(F.mysqlTable)
      if (dbNode()) dbNode().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(600)
      result.tablesCollapsed = !sidebarText().includes(F.mysqlTable)
    } else if ('${target}' === 'settings') {
      const settingsButton = [...document.querySelectorAll('.sidebar-footer button')].find((b) => b.textContent && b.textContent.includes('设置'))
      result.settingsButton = !!settingsButton
      if (settingsButton) settingsButton.click()
      await sleep(700)
      result.modalOpen = document.body.textContent.includes('外观') && document.body.textContent.includes('跟随系统')
      const light = [...document.querySelectorAll('.ant-modal .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === '浅色')
      result.lightOption = !!light
      if (light) light.click()
      await sleep(600)
      result.appClassLight = document.querySelector('.app')?.className
      const system = [...document.querySelectorAll('.ant-modal .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === '跟随系统')
      if (system) system.click()
      await sleep(600)
      result.appClassRestored = document.querySelector('.app')?.className
    } else if ('${target}' === 'mysql-json-short') {
      clickGroup('MySQL')
      await sleep(800)
      clickTree(F.mysqlInstance2)
      await sleep(2000)
      const dbNode = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlDatabase2)
      if (dbNode) dbNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2200)
      const clickTable = (name) => {
        const node = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === name)
        if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return !!node
      }
      const findCell = (column) => {
        const headers = [...document.querySelectorAll('.content .ant-table-thead th')].map((th) => th.textContent?.trim() || '')
        const index = headers.indexOf(column)
        const row = document.querySelector('.content .ant-table-tbody tr.ant-table-row')
        if (!row || index < 0) return null
        const cell = row.querySelectorAll('td')[index]
        return cell?.querySelector('.cell-long-clickable') || null
      }
      result.pending = clickTable(F.mysqlTable3)
      await sleep(3000)
      let longCell = findCell('arguments_json')
      result.argumentsClickable = !!longCell
      result.argumentsWidth = longCell?.getBoundingClientRect().width
      if (longCell) longCell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(900)
      result.panelField1 = document.querySelector('.mysql-detail .detail-key')?.textContent
      let jsonTab = [...document.querySelectorAll('.mysql-detail .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === 'JSON')
      if (jsonTab) jsonTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(700)
      result.jsonLines1 = document.querySelectorAll('.mysql-detail .json-line').length
      const closeButton = document.querySelector('.mysql-detail button[aria-label="关闭字段详情"]')
      if (closeButton) closeButton.click()
      await sleep(400)
      result.ticketEvents = clickTable(F.mysqlTable2)
      await sleep(3000)
      longCell = findCell('payload_json')
      result.payloadClickable = !!longCell
      result.payloadWidth = longCell?.getBoundingClientRect().width
      if (longCell) longCell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(900)
      result.panelField2 = document.querySelector('.mysql-detail .detail-key')?.textContent
      jsonTab = [...document.querySelectorAll('.mysql-detail .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === 'JSON')
      if (jsonTab) jsonTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(700)
      result.jsonLines2 = document.querySelectorAll('.mysql-detail .json-line').length
    } else if ('${target}' === 'mysql-long') {
      clickGroup('MySQL')
      await sleep(800)
      clickTree(F.mysqlInstance2)
      await sleep(2000)
      const dbNode = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlDatabase2)
      if (dbNode) dbNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2200)
      const tableNode = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlTable4)
      result.tableNode = !!tableNode
      if (tableNode) tableNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(3000)
      const headers = [...document.querySelectorAll('.content .ant-table-thead th')].map((th) => th.textContent?.trim() || '')
      const columnIndex = headers.indexOf('response_json')
      const firstRow = document.querySelector('.content .ant-table-tbody tr.ant-table-row')
      const targetCell = firstRow && columnIndex >= 0 ? firstRow.querySelectorAll('td')[columnIndex] : null
      const longCell = targetCell?.querySelector('.cell-long-clickable') || document.querySelector('.cell-long-clickable')
      result.longCell = !!longCell
      if (longCell) longCell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(900)
      result.panelOpen = !!document.querySelector('.mysql-detail')
      result.panelField = document.querySelector('.mysql-detail .detail-key')?.textContent
      const jsonTab = [...document.querySelectorAll('.mysql-detail .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === 'JSON')
      result.jsonTab = !!jsonTab
      if (jsonTab) jsonTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(700)
      result.jsonLines = document.querySelectorAll('.mysql-detail .json-line').length
      result.segmentedActive = [...document.querySelectorAll('.mysql-detail .ant-segmented-item-selected')].map((el) => el.textContent).join(',')
      result.panelText = document.querySelector('.mysql-detail-body')?.textContent?.slice(0, 160)
    } else if ('${target}' === 'mysql-tree') {
      result.group = clickGroup('MySQL')
      await sleep(800)
      result.instance = clickTree(F.mysqlInstance2)
      await sleep(2000)
      const dbNode = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlDatabase2)
      result.dbNode = !!dbNode
      if (dbNode) dbNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2200)
      result.landing = document.querySelector('.content')?.textContent?.includes('在左侧展开')
      result.treeTexts = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].map((n) => n.textContent?.trim()).filter(Boolean)
      const tableNode = [...document.querySelectorAll('.ant-tree-node-content-wrapper')].find((n) => n.textContent && n.textContent.trim() === F.mysqlTable4)
      result.tableNode = !!tableNode
      if (tableNode) tableNode.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2800)
      result.contentText = document.querySelector('.content')?.textContent?.slice(0, 160)
    } else if ('${target}' === 'web-start-5173') {
      clickGroup('Web 应用')
      await sleep(700)
      clickWebPort(':5173')
      await sleep(1600)
      const row = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':5173'))
      result.before = row?.textContent?.slice(0, 100)
      const startButton = row && [...row.querySelectorAll('button')].find((b) => b.textContent && b.textContent.includes('启动'))
      result.startButton = !!startButton
      if (startButton) startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(600)
      const confirmStart = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '启动服务')
      result.confirmStart = !!confirmStart
      if (confirmStart) confirmStart.click()
      await sleep(5000)
      const rowAfter = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':5173'))
      result.after = rowAfter?.textContent?.slice(0, 100)
    } else if ('${target}' === 'web-offline' || '${target}' === 'web-start') {
      result.groupClick = clickGroup('Web 应用')
      await sleep(700)
      clickWebPort()
      await sleep(1600)
      const findRow = (port) => [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':' + port))
      let row = findRow(8055)
      result.initial = row?.textContent
      if ('${target}' === 'web-offline') {
        const killButton = row && [...row.querySelectorAll('button')].find((b) => b.textContent && b.textContent.includes('关闭'))
        result.killButton = !!killButton
        if (killButton) killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(600)
        const confirmKill = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '关闭进程')
        result.confirmKill = !!confirmKill
        if (confirmKill) confirmKill.click()
        await sleep(2800)
        row = findRow(8055)
        result.offlineRow = row?.textContent
      } else {
        const startButton = row && [...row.querySelectorAll('button')].find((b) => b.textContent && b.textContent.includes('启动'))
        result.startButton = !!startButton
        if (startButton) startButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(600)
        const confirmStart = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '启动服务')
        result.confirmStart = !!confirmStart
        if (confirmStart) confirmStart.click()
        await sleep(4500)
        row = findRow(8055)
        result.onlineRow = row?.textContent
      }
    } else if ('${target}' === 'web' || '${target}' === 'web-kill') {
      result.groupClick = clickGroup('Web 应用')
      await sleep(700)
      result.portsVisible = !!document.querySelector('.web-role-text')
      result.manage = clickWebPort()
      await sleep(1200)
      result.ports = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].map((r) => r.textContent)
      const brand = document.querySelector('.brand-home')
      if (brand) brand.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(500)
      result.homeOk = document.body.textContent.includes('本机数据库，一眼看全')
      clickWebPort()
      await sleep(800)
      clickGroup('Web 应用')
      await sleep(300)
      result.collapsed = !document.querySelector('.web-role-text')
      clickGroup('Web 应用')
      await sleep(300)
      result.reExpanded = !!document.querySelector('.web-role-text')
      if ('${target}' === 'web-kill') {
        const row = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':8055'))
        const killButton = row && [...row.querySelectorAll('button')].find((b) => b.textContent && b.textContent.includes('关闭'))
        result.killButton = !!killButton
        if (killButton) killButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(600)
        const confirm = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '关闭进程')
        result.confirm = !!confirm
        if (confirm) confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await sleep(2500)
        result.portGone = !document.body.textContent.includes(':8055')
      }
    } else if ('${target}' === 'mysql-state') {
      try {
        localStorage.removeItem('localpeek.mysqlTableState.v1')
      } catch (error) {}
      clickGroup('MySQL')
      await waitFor(() => document.querySelector('.ant-tree-node-content-wrapper'))
      clickTree(F.mysqlInstance)
      await waitFor(() => [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].some((r) => r.textContent && r.textContent.includes(F.mysqlDatabase)))
      clickRow(F.mysqlDatabase)
      await waitFor(() => [...document.querySelectorAll('.ant-tree-node-content-wrapper')].some((n) => n.textContent && n.textContent.trim() === F.mysqlTable))
      const findColumnHeader = (name) =>
        [...document.querySelectorAll('.content .ant-table-thead th')].find((th) => th.textContent && th.textContent.trim() === name)
      result.openTable = clickTree(F.mysqlTable)
      await waitFor(() => findColumnHeader('id'), 20000)
      const sortersOf = (name) => findColumnHeader(name)?.querySelector('.ant-table-column-sorters')
      result.headers = [...document.querySelectorAll('.content .ant-table-thead th')].map((th) => th.textContent?.trim())
      result.headerFound = !!findColumnHeader('id')
      if (sortersOf('id')) sortersOf('id').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2600)
      if (sortersOf('id')) sortersOf('id').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2600)
      result.sortClassBefore = findColumnHeader('id')?.className
      result.sortBefore = document.querySelector('.content .ant-table-thead .ant-table-column-sort')?.textContent?.trim()
      result.storedBefore = localStorage.getItem('localpeek.mysqlTableState.v1')
      result.switchTable = clickTree(F.mysqlTable5)
      await waitFor(() => {
        const header = findColumnHeader('id')
        return !header || !header.className.includes('ant-table-column-sort')
      }, 12000)
      result.backToTable = clickTree(F.mysqlTable)
      await waitFor(() => findColumnHeader('id'), 20000)
      await sleep(800)
      result.sortClassAfter = findColumnHeader('id')?.className
      result.sortAfter = document.querySelector('.content .ant-table-thead .ant-table-column-sort')?.textContent?.trim()
      result.orderByAfter = document.querySelector('.content .ant-table-thead .ant-table-column-sort .ant-table-column-title')?.textContent
      const sqlButton = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent && b.textContent.trim() === 'SQL')
      if (sqlButton) sqlButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(800)
      result.sql = document.querySelector('.sql-block')?.textContent
      result.storedAfter = localStorage.getItem('localpeek.mysqlTableState.v1')
    } else if ('${target}' === 'web-log-resize') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(900)
      clickWebPort()
      await sleep(2600)
      const findRowByPort = (port) =>
        [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':' + port))
      const clickProcess = (port) => {
        const cell = findRowByPort(port)?.querySelector('.web-process-clickable')
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }
      result.clicks = [clickProcess(5199), clickProcess(5198)]
      await sleep(3200)
      const metrics = () =>
        [...document.querySelectorAll('.web-log-panel')].map((panel) => {
          const pre = panel.querySelector('.web-log-view')
          return {
            panel: Math.round(panel.getBoundingClientRect().width),
            preClient: pre?.clientWidth ?? null,
            preScroll: pre?.scrollWidth ?? null,
            wrap: pre ? getComputedStyle(pre).whiteSpace : null
          }
        })
      result.before = metrics()
      result.drag = await dragBarAsync(document.querySelector('.web-log-splitter .ant-splitter-bar-dragger'), 120, 0)
      result.after = metrics()
      result.lineText = document.querySelector('.web-log-view')?.textContent?.slice(0, 160)
    } else if ('${target}' === 'web-log-multi') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(900)
      clickWebPort()
      await sleep(2600)
      const findRowByPort = (port) =>
        [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':' + port))
      const clickProcess = (port) => {
        const cell = findRowByPort(port)?.querySelector('.web-process-clickable')
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }
      result.clicks = []
      for (const port of [5199, 5198, 5197, 5196]) {
        result.clicks.push(clickProcess(port))
        await sleep(1600)
      }
      const panelWidths = () => [...document.querySelectorAll('.web-log-panel')].map((el) => Math.round(el.getBoundingClientRect().width))
      result.panelCount = document.querySelectorAll('.web-log-panel').length
      result.widths = panelWidths()
      result.heads = [...document.querySelectorAll('.web-log-head')].map((el) => el.textContent?.slice(0, 80))
      result.splitterBars = document.querySelectorAll('.web-log-splitter .ant-splitter-bar').length
      result.drag = await dragBarAsync(document.querySelector('.web-log-splitter .ant-splitter-bar-dragger'), 70, 0)
      result.widthsAfterDrag = panelWidths()
      result.openFifth = clickProcess(8002)
      await sleep(1600)
      result.panelCountAfterFifth = document.querySelectorAll('.web-log-panel').length
      result.headsAfterFifth = [...document.querySelectorAll('.web-log-head')].map((el) => el.textContent?.slice(0, 60))
      result.widthsAfterFifth = panelWidths()
      result.headerVisibility = [...document.querySelectorAll('.web-log-panel')].map((panel) => {
        const display = (sel) => {
          const el = panel.querySelector(sel)
          return el ? getComputedStyle(el).display : null
        }
        return {
          width: Math.round(panel.getBoundingClientRect().width),
          source: display('.web-log-source'),
          online: display('.web-log-online'),
          count: display('.web-log-count'),
          pid: display('.web-log-pid')
        }
      })
      result.stored = localStorage.getItem('localpeek.webLogPorts.v1')
    } else if ('${target}' === 'web-log') {
      clickGroup('Web 应用')
      await sleep(700)
      clickWebPort(':5199')
      await sleep(2200)
      const findLogRow = () => [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':5199'))
      const clickProcess = () => {
        const cell = findLogRow()?.querySelector('.web-process-clickable')
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }
      result.cellFound = !!findLogRow()?.querySelector('.web-process-clickable')
      clickProcess()
      await sleep(2200)
      result.panelOpen = !!document.querySelector('.web-log-panel')
      result.head = document.querySelector('.web-log-head')?.textContent?.slice(0, 180)
      result.logText = document.querySelector('.web-log-view')?.textContent?.slice(0, 240)
      result.rowHighlighted = !!document.querySelector('.row-log-target')
      clickProcess()
      await sleep(600)
      result.panelClosed = !document.querySelector('.web-log-panel')
      clickProcess()
      await sleep(1800)
      result.panelReopened = !!document.querySelector('.web-log-panel')
      result.linesAfterReopen = (document.querySelector('.web-log-view')?.textContent || '').split('\\n').length
    } else if ('${target}' === 'web-log-restart') {
      result.groupClick = clickGroup('Web 应用')
      await sleep(900)
      result.portClick = clickWebPort(':5199')
      await sleep(2600)
      const findRow = () => [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].find((r) => r.textContent && r.textContent.includes(':5199'))
      const clickCell = () => {
        const cell = findRow()?.querySelector('.web-process-clickable')
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }
      result.rows = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')].map((r) => r.textContent?.slice(0, 90))
      result.cellClicked = clickCell()
      await sleep(3000)
      result.headBefore = document.querySelector('.web-log-head')?.textContent?.slice(0, 160)
      result.reason = document.querySelector('.web-log-reason')?.textContent?.slice(0, 220)
      const restartButton = [...document.querySelectorAll('.web-log-panel button')].find((b) => b.textContent && b.textContent.includes('重启并捕获输出'))
      result.restartButton = !!restartButton
      if (restartButton) restartButton.click()
      await sleep(700)
      const confirm = [...document.querySelectorAll('.ant-popconfirm-buttons button')].find((b) => b.textContent && b.textContent.trim() === '重启并捕获')
      result.confirm = !!confirm
      if (confirm) confirm.click()
      await sleep(14000)
      result.headAfter = document.querySelector('.web-log-head')?.textContent?.slice(0, 160)
      result.logAfter = document.querySelector('.web-log-view')?.textContent?.slice(0, 220)
      result.panelOpenAfter = !!document.querySelector('.web-log-panel')
    } else if ('${target}' === 'readme-mysql') {
      result.group = clickGroup('MySQL')
      await sleep(1000)
      result.instance = clickTree(F.demoMysql)
      await sleep(3500)
      result.database = clickRow(F.demoDatabase)
      await sleep(2500)
      result.table = clickTree(F.demoTable)
      await sleep(4500)
      const headers = [...document.querySelectorAll('.content .ant-table-thead th')].map((th) => th.textContent?.trim())
      result.headers = headers
      const valueIndex = headers.indexOf('profile')
      const rows = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')]
      result.rows = rows.length
      const cell =
        valueIndex >= 0
          ? rows[0]?.querySelectorAll('td')[valueIndex]?.querySelector('.cell-long-clickable')
          : null
      result.cell = !!cell
      if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1500)
      const jsonTab = [...document.querySelectorAll('.mysql-detail .ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === 'JSON')
      if (jsonTab) jsonTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(900)
      result.detail = !!document.querySelector('.mysql-detail')
      result.jsonLines = document.querySelectorAll('.mysql-detail .json-line').length
      hideSidebar()
      await sleep(600)
    } else if ('${target}' === 'readme-redis') {
      result.group = expandGroup('Redis')
      await sleep(900)
      result.instance = clickTree(F.demoRedis)
      await sleep(3500)
      const matchInput = [...document.querySelectorAll('.redis-toolbar input')].find(
        (input) => input.placeholder && input.placeholder.includes('MATCH')
      )
      result.match = !!matchInput
      if (matchInput) setInputValue(matchInput, F.demoPattern)
      await sleep(1800)
      const rows = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')]
      result.rows = rows.length
      let cell = null
      for (const row of rows) {
        const found = row.querySelectorAll('td')[1]?.querySelector('.cell-long-clickable')
        if (found) {
          cell = found
          break
        }
      }
      result.cell = !!cell
      if (cell) cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1800)
      result.detail = !!document.querySelector('.redis-detail')
      result.segmented = [...document.querySelectorAll('.redis-detail .ant-segmented-item-selected')].map((el) => el.textContent).join(',')
      hideSidebar()
      await sleep(600)
    } else if ('${target}' === 'home-demo') {
      const redact = () => {
        document.querySelectorAll('.tree-label, .recent-label').forEach((el) => {
          const text = el.textContent || ''
          if (!text) return
          if (/redis/i.test(text)) el.textContent = 'Demo Redis'
          else if (/mysql/i.test(text)) el.textContent = 'Demo MySQL'
        })
      }
      redact()
      setInterval(redact, 150)
      await sleep(800)
    } else if ('${target}' === 'ui-sidebar') {
      clickGroup('Redis')
      await sleep(600)
      clickGroup('Web 应用')
      await sleep(600)
      result.port = clickWebPort(':5198')
      await sleep(1200)
      result.groups = [...document.querySelectorAll('.tree-group')].map((el) => ({
        text: el.textContent?.trim(),
        background: getComputedStyle(el).backgroundColor
      }))
      result.selected = [...document.querySelectorAll('.ant-tree-node-selected')].map(
        (el) => el.textContent?.trim()
      )
    } else if ('${target}' === 'light-sidebar') {
      const settingsButton = [...document.querySelectorAll('.sidebar-footer button')].find(
        (b) => b.textContent && b.textContent.includes('设置')
      )
      if (settingsButton) settingsButton.click()
      await sleep(700)
      const light = [...document.querySelectorAll('.ant-modal .ant-segmented-item')].find(
        (el) => el.textContent && el.textContent.trim() === '浅色'
      )
      if (light) light.click()
      await sleep(600)
      const close = document.querySelector('.ant-modal-close')
      if (close) close.click()
      await sleep(600)
      clickGroup('MySQL')
      await sleep(500)
    } else if ('${target}' === 'web-table') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(1000)
      clickWebPort()
      await sleep(3200)
      const search = document.querySelector('.pane-toolbar input')
      if (search) setInputValue(search, F.demoProject)
      await sleep(1500)
      result.rows = [...document.querySelectorAll('.content .port-row')].map((row) =>
        row.textContent?.slice(0, 80)
      )
      const redactUser = () => {
        document.querySelectorAll('.web-process .muted').forEach((el) => {
          el.textContent = (el.textContent || '').replace(/sunbridger/g, 'demo')
        })
      }
      redactUser()
      setInterval(redactUser, 100)
      hideSidebar()
      await sleep(600)
    } else if ('${target}' === 'project-modal') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(1000)
      clickWebPort()
      await sleep(3200)
      const search = document.querySelector('.pane-toolbar input')
      if (search) setInputValue(search, F.demoProject)
      await sleep(1500)
      const findProject = (name) =>
        [...document.querySelectorAll('.project-block')].find(
          (el) => el.querySelector('.project-name')?.textContent?.trim() === name
        )
      result.project = !!findProject(F.demoProject)
      const edit = findProject(F.demoProject)?.querySelector('.project-edit')
      result.edit = !!edit
      if (edit) edit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(800)
      result.modal = !!document.querySelector('.project-edit-body')
      const redactUser = () => {
        document.querySelectorAll('.web-process .muted').forEach((el) => {
          el.textContent = (el.textContent || '').replace(/sunbridger/g, 'demo')
        })
      }
      redactUser()
      setInterval(redactUser, 100)
      hideSidebar()
      await sleep(600)
    } else if ('${target}' === 'project-merge') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(1000)
      clickWebPort()
      await sleep(3200)
      const findProject = (name) =>
        [...document.querySelectorAll('.project-block')].find(
          (el) => el.querySelector('.project-name')?.textContent?.trim() === name
        )
      const blocks = () =>
        [...document.querySelectorAll('.project-block')].map((el) => ({
          name: el.querySelector('.project-name')?.textContent?.trim(),
          count: el.querySelectorAll('.port-row').length
        }))
      result.before = blocks()
      const edit = findProject(F.demoProjectA)?.querySelector('.project-edit')
      result.edit = !!edit
      if (edit) edit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(700)
      const input = document.querySelector('.project-edit-body input')
      if (input) setInputValue(input, F.demoProjectB)
      await sleep(300)
      const save = document.querySelector('.ant-modal-footer .ant-btn-primary')
      result.save = !!save
      if (save) save.click()
      await sleep(4200)
      result.afterMerge = blocks()
      const beta = findProject(F.demoProjectB)
      const resetEdit = beta?.querySelector('.project-edit')
      result.mergedCount = beta?.querySelectorAll('.port-row').length
      if (resetEdit) resetEdit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(700)
      const reset = [...document.querySelectorAll('.project-edit-body button')].find((button) =>
        button.textContent?.includes('恢复自动名称')
      )
      result.resetButton = !!reset
      if (reset) reset.click()
      await sleep(4200)
      result.afterReset = blocks()
    } else if ('${target}' === 'readme-web') {
      try {
        localStorage.removeItem('localpeek.webLogPorts.v1')
        localStorage.removeItem('localpeek.webLogPort.v1')
      } catch (error) {}
      clickGroup('Web 应用')
      await sleep(1000)
      clickWebPort()
      await sleep(3000)
      const search = document.querySelector('.pane-toolbar input')
      if (search) setInputValue(search, F.demoProject)
      await sleep(1500)
      const findRow = (port) =>
        [...document.querySelectorAll('.content .port-row')].find((r) => r.textContent && r.textContent.includes(':' + port))
      const clickProcess = (port) => {
        const cell = findRow(port)?.querySelector('.web-process-clickable')
        if (!cell) return false
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }
      result.clicks = []
      for (const port of F.demoPorts) {
        result.clicks.push(clickProcess(port))
        await sleep(2400)
      }
      result.panels = document.querySelectorAll('.web-log-panel').length
      result.rows = [...document.querySelectorAll('.content .port-row')].map((r) => r.textContent?.slice(0, 80))
      const redactUser = () => {
        document.querySelectorAll('.web-process .muted').forEach((el) => {
          el.textContent = (el.textContent || '').replace(/sunbridger/g, 'demo')
        })
      }
      redactUser()
      setInterval(redactUser, 100)
      hideSidebar()
      await sleep(600)
    } else if ('${target}' === 'redis-value') {
      result.group = expandGroup('Redis')
      await sleep(800)
      result.tree = clickTree('本地 Redis')
      await sleep(2800)
      const headers = [...document.querySelectorAll('.content .ant-table-thead th')].map((th) => th.textContent?.trim())
      result.headers = headers
      const valueIndex = headers.indexOf('Value')
      const typeIndex = headers.indexOf('类型')
      const rows = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')]
      result.rowCount = rows.length
      result.rows = rows.slice(0, 8).map((row) => {
        const cells = row.querySelectorAll('td')
        return {
          key: cells[0]?.textContent?.slice(0, 60),
          value: cells[valueIndex]?.textContent?.slice(0, 100),
          long: !!cells[valueIndex]?.querySelector('.cell-long-clickable'),
          type: cells[typeIndex]?.textContent
        }
      })
      const targetRow = rows.find((row) => row.querySelectorAll('td')[valueIndex]?.querySelector('.cell-long-clickable'))
      result.clicked = false
      if (targetRow) {
        const cell = targetRow.querySelectorAll('td')[valueIndex].querySelector('.cell-long-clickable')
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        result.clicked = true
      }
      await sleep(2000)
      result.detailOpen = !!document.querySelector('.redis-detail')
      result.detailKey = document.querySelector('.redis-detail .detail-key')?.textContent
      result.segmentedActive = [...document.querySelectorAll('.redis-detail .ant-segmented-item-selected')].map((el) => el.textContent).join(',')
      result.jsonLines = document.querySelectorAll('.redis-detail .json-line').length
    } else if ('${target}' === 'redis-json') {
      result.group = expandGroup('Redis')
      await sleep(800)
      result.tree = clickTree('本地 Redis')
      await sleep(2500)
      const rows = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')]
      const jsonRow = rows.find((r) => r.textContent && r.textContent.includes('agent:run:run-')) || rows[0]
      result.key = jsonRow?.textContent?.slice(0, 40)
      if (jsonRow) jsonRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(2000)
      const jsonTab = [...document.querySelectorAll('.ant-segmented-item')].find((el) => el.textContent && el.textContent.trim() === 'JSON')
      result.jsonTab = !!jsonTab
      if (jsonTab) jsonTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(800)
      result.detailText = document.querySelector('.redis-detail-body')?.textContent?.slice(0, 120)
      const rowsAgain = [...document.querySelectorAll('.content .ant-table-tbody tr.ant-table-row')]
      const otherJson = rowsAgain.find((r) => r !== jsonRow && r.textContent && r.textContent.includes('agent:run:run-'))
      if (otherJson) otherJson.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1600)
      result.persistJson = !!document.querySelector('.json-line')
      result.segmentedActive = [...document.querySelectorAll('.ant-segmented-item-selected')].map((el) => el.textContent).join(',')
      if (otherJson) jsonRow && jsonRow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(1600)
      result.jsonLines = document.querySelectorAll('.json-line').length
      const caret = document.querySelector('.json-caret:not(.json-caret-placeholder)')
      if (caret) caret.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await sleep(400)
      result.afterCollapse = document.querySelectorAll('.json-line').length
      const expandAllButton = document.querySelector('.redis-detail-head button[aria-label="展开全部"]')
      if (expandAllButton) expandAllButton.click()
      await sleep(500)
      result.afterExpandAll = document.querySelectorAll('.json-line').length
      const defaultButton = document.querySelector('.redis-detail-head button[aria-label="恢复默认展开层级"]')
      if (defaultButton) defaultButton.click()
      await sleep(500)
      result.sidebarDrag = dragBar(document.querySelector('.main-splitter .ant-splitter-bar-dragger'), 120, 0)
      await sleep(600)
      result.detailDrag = dragBar(document.querySelector('.redis-splitter .ant-splitter-bar-dragger'), 0, -90)
      await sleep(600)
      result.sidebarWidth = document.querySelector('.sidebar')?.getBoundingClientRect().width
      result.detailHeight = document.querySelector('.redis-detail')?.getBoundingClientRect().height
    }
    return result
  })()`
  try {
    const result = await window.webContents.executeJavaScript(script, true)
    console.log('[localpeek:capture:drive]', JSON.stringify(result))
  } catch (error) {
    console.error('[localpeek:capture:drive] failed', error)
  }
}
