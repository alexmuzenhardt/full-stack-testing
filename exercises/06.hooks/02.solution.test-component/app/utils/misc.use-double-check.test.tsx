/**
 * @vitest-environment jsdom
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import userEventDefault from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import { useDoubleCheck } from './misc.tsx'

// https://github.com/testing-library/user-event/issues/1146
const userEvent = userEventDefault.default ?? userEventDefault

test('hook: prevents default on the first click, and does not on the second', () => {
	const { result } = renderHook(() => useDoubleCheck())
	expect(result.current.doubleCheck).toBe(false)
	const myClick = vi.fn()
	const click1 = new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
	})
	// @ts-expect-error the types here are different :(
	act(() => result.current.getButtonProps({ onClick: myClick }).onClick(click1))
	expect(myClick).toHaveBeenCalledWith(click1)
	expect(myClick).toHaveBeenCalledTimes(1)
	expect(click1.defaultPrevented).toBe(true)
	myClick.mockClear()

	const click2 = new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
	})
	// @ts-expect-error the types here are different :(
	act(() => result.current.getButtonProps({ onClick: myClick }).onClick(click2))
	expect(myClick).toHaveBeenCalledWith(click2)
	expect(myClick).toHaveBeenCalledTimes(1)
	expect(click2.defaultPrevented).toBe(false)
})

function TestComponent() {
	const [defaultPrevented, setDefaultPrevented] = useState<
		'idle' | 'no' | 'yes'
	>('idle')
	const dc = useDoubleCheck()
	return (
		<div>
			<output>Default Prevented: {defaultPrevented}</output>
			<button
				{...dc.getButtonProps({
					onClick: e => setDefaultPrevented(e.defaultPrevented ? 'yes' : 'no'),
				})}
			>
				{dc.doubleCheck ? 'You sure?' : 'Click me'}
			</button>
		</div>
	)
}

test('TestComponent: prevents default on the first click, and does not on the second', async () => {
	const user = userEvent.setup()
	render(<TestComponent />)

	const status = screen.getByRole('status')
	const button = screen.getByRole('button')

	expect(status.textContent).toBe('Default Prevented: idle')
	expect(button.textContent).toBe('Click me')

	await user.click(button)
	expect(button.textContent).toBe('You sure?')
	expect(status.textContent).toBe('Default Prevented: yes')

	await user.click(button)
	expect(button.textContent).toBe('You sure?')
	expect(status.textContent).toBe('Default Prevented: no')
})
