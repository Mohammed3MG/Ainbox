import googleLogo from '../../../public/img/google.png'
import microsoftLogo from '../../../public/img/outlook.png'
import yahooLogo from '../../../public/img/yahoo.png'
import exchangeLogo from '../../../public/img/exchange.png'

import { API_BASE_URL } from '../../config'

function Home() {
  const google = `${API_BASE_URL.replace(/\/$/, '')}/google`
  const microsoft = `${API_BASE_URL.replace(/\/$/, '')}/auth/outlook`
  const yahoo = `${API_BASE_URL.replace(/\/$/, '')}/auth/yahoo`
  const imap = `${API_BASE_URL.replace(/\/$/, '')}/other/login`

  return (
    <div className="w-screen h-screen">
      <div className="relative h-screen">
        <div className="absolute inset-0">
          <div className="absolute inset-0 -z-10 h-full w-full items-center px-5 py-24 [background:radial-gradient(125%_125%_at_50%_10%,#000_40%,#63e_100%)]"></div>
        </div>

        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
          <div className="max-w-3xl text-center">
            <h1 className="mb-8 text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl text-white">
              <span className="text-sky-400">Fyl</span>
            </h1>

            <h3 className="mx-auto mb-8 max-w-2xl text-3xl text-slate-300">
              Your <span className="text-sky-400 font-bold">AI</span> powered email companion
            </h3>

            <p className="mx-auto mb-8 max-w-2xl text-lg text-slate-300">
              Helping you organize emails smarter, faster and with less effort.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <a
                href={google}
                className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                <img src={googleLogo} alt="Sign in with Google" className="w-8 h-8" />
              </a>

              <a
                href={microsoft}
                className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                <img src={microsoftLogo} alt="Sign in with Microsoft" className="w-8 h-8" />
              </a>

              <a
                href={yahoo}
                className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                <img src={yahooLogo} alt="Sign in with Yahoo" className="w-8 h-8" />
              </a>

              <a
                href={imap}
                className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                <img src={exchangeLogo} alt="Exchange (IMAP/SMTP)" className="w-8 h-8" />
              </a>

              <a
                href={imap}
                className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
              >
                Other
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Home
