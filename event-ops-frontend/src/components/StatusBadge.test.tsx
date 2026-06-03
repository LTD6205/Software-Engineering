import { render, screen } from '@testing-library/react'
import StatusBadge from './StatusBadge'
import { LanguageProvider } from '@/context/LanguageContext'

// StatusBadge calls useLang(), so render inside the real LanguageProvider
// (defaults to English).
function renderBadge(status: React.ComponentProps<typeof StatusBadge>['status']) {
  return render(
    <LanguageProvider>
      <StatusBadge status={status} />
    </LanguageProvider>,
  )
}

describe('<StatusBadge />', () => {
  it('renders the English label for each status', () => {
    renderBadge('in_progress')
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('renders priority labels too', () => {
    renderBadge('high')
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('falls back to the Pending label for an unknown status', () => {
    // @ts-expect-error — deliberately passing an out-of-union value.
    renderBadge('bogus')
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })
})
