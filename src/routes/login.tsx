import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { login, me } from '~/functions/auth.fn'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

export const Route = createFileRoute('/login')({
  // Already signed in? Skip the form.
  beforeLoad: async () => {
    const { authenticated } = await me()
    if (authenticated) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (value: string) => login({ data: { pin: value } }),
    onSuccess: async (result) => {
      if (result.ok) {
        await router.invalidate()
        await router.navigate({ to: '/' })
      } else {
        setError('Incorrect PIN.')
        setPin('')
      }
    },
    onError: () => setError('Something went wrong. Try again.'),
  })

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          mutation.mutate(pin)
        }}
        className="flex w-full max-w-xs flex-col gap-3"
      >
        <h1 className="text-lg font-semibold">hts-manager</h1>
        <label htmlFor="pin" className="text-sm font-medium">
          Enter access PIN
        </label>
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          disabled={mutation.isPending}
        />
        <Button type="submit" disabled={mutation.isPending || pin.length === 0}>
          {mutation.isPending ? 'Checking…' : 'Sign in'}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </main>
  )
}
