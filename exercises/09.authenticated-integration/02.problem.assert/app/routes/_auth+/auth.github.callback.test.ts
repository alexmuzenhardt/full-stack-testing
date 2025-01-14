import { generateTOTP } from '@epic-web/totp'
import { faker } from '@faker-js/faker'
import { rest } from 'msw'
import * as setCookieParser from 'set-cookie-parser'
import { expect, test } from 'vitest'
import { createUser } from 'tests/db-utils.ts'
import { mockGithubProfile, primaryGitHubEmail } from 'tests/mocks/github.ts'
import { server } from 'tests/mocks/index.ts'
import { consoleError } from 'tests/setup/setup-test-env.ts'
import { sessionKey } from '~/utils/auth.server.ts'
import { prisma } from '~/utils/db.server.ts'
import { invariant } from '~/utils/misc.tsx'
import { sessionStorage } from '~/utils/session.server.ts'
import { twoFAVerificationType } from '../settings+/profile.two-factor.tsx'
import { ROUTE_PATH, loader } from './auth.github.callback.ts'

const BASE_URL = 'https://www.epicstack.dev'
const RESOURCE_URL_STRING = `${BASE_URL}${ROUTE_PATH}`

test('a new user goes to onboarding', async () => {
	const request = await setupRequest()
	const response = await loader({ request, params: {}, context: {} })
	assertRedirect(response, '/onboarding/github')
})

test('when auth fails, send the user to login with a toast', async () => {
	server.use(
		rest.post('https://github.com/login/oauth/access_token', async () => {
			return new Response('error', { status: 400 })
		}),
	)
	const request = await setupRequest()
	const response = await loader({ request, params: {}, context: {} }).catch(
		e => e,
	)
	invariant(response instanceof Response, 'response should be a Response')
	assertRedirect(response, '/login')
	assertToastSent(response)
	expect(consoleError).toHaveBeenCalledTimes(1)
	consoleError.mockClear()
})

test('when a user is logged in, it creates the connection', async () => {
	const session = await setupUser()
	const request = await setupRequest({ session })
	const response = await loader({ request, params: {}, context: {} })
	assertRedirect(response, '/settings/profile/connections')
	assertToastSent(response)
	const connection = await prisma.gitHubConnection.findFirst({
		select: { id: true },
		where: {
			userId: session.userId,
			providerId: mockGithubProfile.id.toString(),
		},
	})
	expect(
		connection,
		'the connection was not created in the database',
	).toBeTruthy()
})

test(`when a user is logged in and has already connected, it doesn't do anything and just redirects the user back to the connections page`, async () => {
	const session = await setupUser()
	await prisma.gitHubConnection.create({
		data: {
			userId: session.userId,
			providerId: mockGithubProfile.id.toString(),
		},
	})
	const request = await setupRequest({ session })
	const response = await loader({ request, params: {}, context: {} })
	assertRedirect(response, '/settings/profile/connections')
	assertToastSent(response)
})

test('when a user exists with the same email, create connection and make session', async () => {
	const email = primaryGitHubEmail.email.toLowerCase()
	const { userId } = await setupUser({ ...createUser(), email })
	const request = await setupRequest()
	const response = await loader({ request, params: {}, context: {} })

	assertRedirect(response, '/')

	assertToastSent(response)

	const connection = await prisma.gitHubConnection.findFirst({
		select: { id: true },
		where: {
			userId: userId,
			providerId: mockGithubProfile.id.toString(),
		},
	})
	expect(
		connection,
		'the connection was not created in the database',
	).toBeTruthy()

	await assertSessionMade(response, userId)
})

test('gives an error if the account is already connected to another user', async () => {
	await prisma.user.create({
		data: {
			...createUser(),
			gitHubConnections: {
				create: { providerId: mockGithubProfile.id.toString() },
			},
		},
	})
	const session = await setupUser()
	const request = await setupRequest({ session })
	const response = await loader({ request, params: {}, context: {} })
	assertRedirect(response, '/settings/profile/connections')
	assertToastSent(response)
})

test('if a user is not logged in, but the connection exists, make a session', async () => {
	const { userId } = await setupUser()
	await prisma.gitHubConnection.create({
		data: {
			providerId: mockGithubProfile.id.toString(),
			userId,
		},
	})
	const request = await setupRequest()
	const response = await loader({ request, params: {}, context: {} })
	assertRedirect(response, '/')
	await assertSessionMade(response, userId)
})

test('if a user is not logged in, but the connection exists and they have enabled 2FA, send them to verify their 2FA and do not make a session', async () => {
	const { userId } = await setupUser()
	await prisma.gitHubConnection.create({
		data: {
			providerId: mockGithubProfile.id.toString(),
			userId,
		},
	})
	const { otp: _otp, ...config } = generateTOTP()
	await prisma.verification.create({
		data: {
			type: twoFAVerificationType,
			target: userId,
			...config,
		},
	})
	const request = await setupRequest()
	const response = await loader({ request, params: {}, context: {} })
	expect(response.status).toBe(302)
	const searchParams = new URLSearchParams({
		type: twoFAVerificationType,
		target: userId,
		redirectTo: '/',
		remember: 'on',
	})
	searchParams.sort()
	expect(response.headers.get('location')).toBe(`/verify?${searchParams}`)
	await assertSessionMade(response, userId)
})

async function setupRequest({ session }: { session?: { id: string } } = {}) {
	const url = new URL(RESOURCE_URL_STRING)
	const state = faker.string.uuid()
	const code = faker.string.uuid()
	url.searchParams.set('state', state)
	url.searchParams.set('code', code)
	const cookieSession = await sessionStorage.getSession()
	cookieSession.set('oauth2:state', state)
	if (session) cookieSession.set(sessionKey, session.id)
	const setCookieHeader = await sessionStorage.commitSession(cookieSession)
	const request = new Request(url.toString(), {
		method: 'GET',
		headers: { cookie: convertSetCookieToCookie(setCookieHeader) },
	})
	return request
}

async function setupUser(userData = createUser()) {
	const session = await prisma.session.create({
		data: {
			expirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
			user: {
				create: {
					...userData,
				},
			},
		},
		select: {
			id: true,
			userId: true,
		},
	})

	return session
}

// we're going to improve this later
function assertToastSent(response: Response) {
	const setCookie = response.headers.get('set-cookie')
	invariant(setCookie, 'set-cookie header should be set')
	const parsedCookie = setCookieParser.splitCookiesString(setCookie)
	expect(parsedCookie).toEqual(
		expect.arrayContaining([expect.stringContaining('en_toast')]),
	)
}

async function assertSessionMade(response: Response, userId: string) {
	// TODO: improve instructions
}

function assertRedirect(response: Response, redirectTo: string) {
	expect(response.status).toBe(302)
	expect(response.headers.get('location')).toBe(redirectTo)
}

function convertSetCookieToCookie(setCookie: string) {
	const parsedCookie = setCookieParser.parseString(setCookie)
	return new URLSearchParams({
		[parsedCookie.name]: parsedCookie.value,
	}).toString()
}
