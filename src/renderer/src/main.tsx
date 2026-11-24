import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { migrateLegacyStorage } from '../../shared/legacyStorage'
import type { ThemeMode } from '../../shared/types'
import App from './App'
import './styles.css'

const THEME_STORAGE_KEY = 'localpeek-theme'

migrateLegacyStorage(window.localStorage)

function readStoredThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function Root() {
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  }, [themeMode])

  const dark = themeMode === 'system' ? systemDark : themeMode === 'dark'

  const themeConfig = useMemo(
    () => ({
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: '#5b8def',
        borderRadius: 8,
        fontSize: 13
      },
      components: {
        Splitter: {
          splitTriggerSize: 10,
          splitBarSize: 2,
          splitBarDraggableSize: 14
        },
        Tree: {
          titleHeight: 22,
          indentSize: 14,
          switcherSize: 18
        }
      }
    }),
    [dark]
  )

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntApp>
        <App
          dark={dark}
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
        />
      </AntApp>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
