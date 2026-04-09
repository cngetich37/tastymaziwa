export { auth as middleware } from "@/auth"

export const config = {
  // Only run the middleware on routes that aren't static files or the login page
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
}
