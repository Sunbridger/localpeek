document.documentElement.classList.add('js')

const header = document.querySelector('.site-header')
const nav = document.querySelector('.site-nav')
const navToggle = document.querySelector('.nav-toggle')

const setHeaderState = () => {
  if (!header) return
  header.classList.toggle('is-scrolled', window.scrollY > 8)
}

setHeaderState()
window.addEventListener('scroll', setHeaderState, { passive: true })

if (nav && navToggle) {
  const closeNav = () => {
    nav.classList.remove('is-open')
    navToggle.setAttribute('aria-expanded', 'false')
    navToggle.setAttribute('aria-label', '打开导航')
  }

  navToggle.addEventListener('click', () => {
    const open = !nav.classList.contains('is-open')
    nav.classList.toggle('is-open', open)
    navToggle.setAttribute('aria-expanded', String(open))
    navToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航')
  })

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav()
  })

  document.addEventListener('click', (event) => {
    if (!nav.classList.contains('is-open')) return
    if (nav.contains(event.target) || navToggle.contains(event.target)) return
    closeNav()
  })
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const revealItems = document.querySelectorAll('.reveal')

if ('IntersectionObserver' in window && !reduceMotion) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  )
  revealItems.forEach((item) => observer.observe(item))
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'))
}

document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = String(new Date().getFullYear())
})
