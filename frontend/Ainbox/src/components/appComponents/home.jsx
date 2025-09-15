import googleLogo from '../../../public/img/google.png'
import microsoftLogo from '../../../public/img/outlook.png'
import yahooLogo from '../../../public/img/yahoo.png'
import exchangeLogo from '../../../public/img/exchange.png'

import { Link } from 'react-router-dom'

const google = "http://localhost:3000/google";
const microsoft = "http://localhost:3000/auth/outlook";
const yahoo = "http://localhost:3000/auth/yahoo";
const imap = "http://localhost:3000/other/login";

function Home() {
    return (   
        <div className="w-screen h-screen">
          <div className="relative h-screen">

  <div className="absolute inset-0">
    <div className="absolute inset-0 -z-10 h-full w-full items-center px-5 py-24 [background:radial-gradient(125%_125%_at_50%_10%,#000_40%,#63e_100%)]"></div>
  </div>
  
  
  <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
    <div className="max-w-3xl text-center">
      <h1 className="mb-8 text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl text-white">
        <span className="text-sky-400">Ai</span>
        NBOX
        </h1>

        <h3 className="mx-auto mb-8 max-w-2xl text-3xl text-slate-300">
        Your <span className="text-sky-400 font-bold">Ai</span> powered email companion
                        </h3>    
                
      <p className="mx-auto mb-8 max-w-2xl text-lg text-slate-300">
Helping you organize emails smarter, faster and with less effort.
      </p>
      <div className="flex flex-wrap justify-center gap-4">
       
          <Link
        to={google}
        className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
          <img src={googleLogo} alt="Google" className="w-8 h-8" />
         </Link>
                            
                            
        <Link
        to={microsoft}
        className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
          <img src={microsoftLogo} alt="Microsoft" className="w-8 h-8" />
         </Link>

           <Link
        to={yahoo}
        className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
          <img src={yahooLogo} alt="Yahoo" className="w-8 h-8" />
         </Link>


        <Link
        to={imap}
        className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
         <img src={exchangeLogo} alt="Exchnage imap / smpt" className="w-8 h-8" />
        </Link>
                            
        <Link
        to={imap}
        className="rounded-lg border px-6 py-3 font-medium border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
         Other
         </Link>

        <div class="mask-radial-farthest-corner mask-radial-from-100% mask-radial-at-[30%_30%] bg-[url(/img/mountains.jpg)] ..."></div>                    

      </div>
    </div>
  </div>
</div>
            
</div>

        
    )
}

export default Home