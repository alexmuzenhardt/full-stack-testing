import closeWithGrace from 'close-with-grace'
import { passthrough, rest } from 'msw'
import { setupServer } from 'msw/node'
import { handlers as githubHandlers } from './github.ts'
import { handlers as resendHandlers } from './resend.ts'

const miscHandlers = [
	process.env.REMIX_DEV_HTTP_ORIGIN
		? rest.post(`${process.env.REMIX_DEV_HTTP_ORIGIN}ping`, passthrough)
		: null,
].filter(Boolean)

export const server = setupServer(
	...miscHandlers,
	...resendHandlers,
	...githubHandlers,
)

server.listen({
	onUnhandledRequest(request, print) {
		if (
			request.url.includes(process.cwd()) ||
			request.url.includes('node_modules')
		) {
			return
		}
		print.warning()
	},
})

if (process.env.NODE_ENV !== 'test') {
	console.info('🔶 Mock server installed')

	closeWithGrace(() => {
		server.close()
	})
}
