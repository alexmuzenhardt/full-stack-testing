import * as setCookieParser from 'set-cookie-parser'
import { expect } from 'vitest'
import { convertSetCookieToCookie } from 'tests/utils.ts'
import { sessionKey } from '~/utils/auth.server.ts'
import { prisma } from '~/utils/db.server.ts'
import { sessionStorage } from '~/utils/session.server.ts'
import {
	type OptionalToast,
	toastSessionStorage,
	toastKey,
} from '~/utils/toast.server.ts'

expect.extend({
	toHaveRedirect(response: Response, redirectTo: string) {
		const isRedirectStatusCode = response.status >= 300 && response.status < 400
		if (!isRedirectStatusCode) {
			return {
				pass: false,
				message: () =>
					`Expected redirect to ${
						this.isNot ? 'not ' : ''
					}be ${redirectTo} but got ${response.status}`,
			}
		}
		const location = response.headers.get('location')
		return {
			pass: location === redirectTo,
			message: () =>
				`Expected redirect to ${
					this.isNot ? 'not ' : ''
				}be ${redirectTo} but got ${location}`,
		}
	},
	async toHaveSessionForUser(response: Response, userId: string) {
		const setCookies = getSetCookie(response.headers)
		const sessionSetCookie = setCookies.find(
			c => setCookieParser.parseString(c).name === 'en_session',
		)

		if (!sessionSetCookie) {
			return {
				pass: false,
				message: () =>
					`The en_session set-cookie header was${
						this.isNot ? '' : ' not'
					} defined`,
			}
		}

		const cookieSession = await sessionStorage.getSession(
			convertSetCookieToCookie(sessionSetCookie),
		)
		const sessionValue = cookieSession.get(sessionKey)

		if (!sessionValue) {
			return {
				pass: false,
				message: () => `A session was${this.isNot ? '' : ' not'} set in cookie`,
			}
		}

		const session = await prisma.session.findUnique({
			select: { id: true },
			where: { userId, id: sessionValue },
		})

		return {
			pass: Boolean(session),
			message: () =>
				`A session was${
					this.isNot ? ' not' : ''
				} created in the database for ${userId}`,
		}
	},
	async toSendToast(response: Response, toast: OptionalToast) {
		const setCookies = getSetCookie(response.headers)
		const toastSetCookie = setCookies.find(
			c => setCookieParser.parseString(c).name === 'en_toast',
		)

		if (!toastSetCookie) {
			return {
				pass: false,
				message: () =>
					`en_toast set-cookie header was${this.isNot ? '' : ' not'} defined`,
			}
		}

		const toastSession = await toastSessionStorage.getSession(
			convertSetCookieToCookie(toastSetCookie),
		)
		const toastValue = toastSession.get(toastKey)

		if (!toastValue) {
			return {
				pass: false,
				message: () => `toast was${this.isNot ? '' : ' not'} set in session`,
			}
		}

		const pass = this.equals(toastValue, toast)

		const diff = pass ? null : `\n${this.utils.diff(toastValue, toast)}`

		return {
			pass,
			message: () =>
				`toast in the response ${
					this.isNot ? 'does not match' : 'matches'
				} the expected toast${diff}`,
		}
	},
})

interface CustomMatchers<R = unknown> {
	toHaveRedirect(redirectTo: string): R
	toHaveSessionForUser(userId: string): Promise<R>
	toSendToast(toast: OptionalToast): Promise<R>
}

declare module 'vitest' {
	interface Assertion<T = any> extends CustomMatchers<T> {}
	interface AsymmetricMatchersContaining extends CustomMatchers {}
}

function getSetCookie(headers: Headers) {
	// this is a sort of polyfill for headers.getSetCookie
	// https://github.com/microsoft/TypeScript/issues/55270
	// https://github.com/remix-run/remix/issues/7067
	// @ts-expect-error see the two issues above
	return headers.getAll('set-cookie') as Array<string>
}
