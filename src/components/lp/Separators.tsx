'use client'

export function WaveSeparatorPosition({ position = 'top', color = 'fill-slate-50' }: { position?: 'top' | 'bottom', color?: string }) {
    return (
        <div className={`absolute left-0 w-full overflow-hidden leading-none z-10 ${position === 'top' ? 'top-0 rotate-180' : 'bottom-0'}`}>
            <svg data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none" className={`relative block w-full h-[60px] md:h-[100px] ${color}`}>
                <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V0H0V27.35A600.21,600.21,0,0,0,321.39,56.44Z"></path>
            </svg>
        </div>
    )
}

export function DiagonalSeparator({ position = 'bottom', color = 'fill-slate-900' }: { position?: 'top' | 'bottom', color?: string }) {
    return (
        <div className={`absolute left-0 w-full overflow-hidden leading-none z-10 ${position === 'top' ? 'top-0' : 'bottom-0'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none" className={`relative block w-full h-[80px] md:h-[150px] ${color}`}>
                <path d="M1200 120L0 16.48V0h1200v120z"></path>
            </svg>
        </div>
    )
}


export function TornPaperSeparator({ position = 'top', color = 'fill-slate-50' }: { position?: 'top' | 'bottom', color?: string }) {
    // 破れた紙のようなギザギザ
    return (
        <div className={`absolute left-0 w-full overflow-hidden leading-none z-20 ${position === 'top' ? 'top-[-1px] rotate-180' : 'bottom-[-1px]'}`}>
            <svg className={`relative block w-[calc(100%+1.3px)] h-[40px] md:h-[60px] ${color}`} data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0V46.29c47,24.5,94,65.8,141.22,46.29,47.2-19.5,94.38-20,141.56,20,47.16,40,94.32,40,141.52,0,47.16-40,94.32-39.5,141.52-20,47.18,19.5,94.32,40,141.5,20,47.2-20,94.36-19.5,141.56,20,47.2,39.5,94.32,54,141.48,14S1133.24,53.21,1200,0V0Z"></path>
            </svg>
        </div>
    )
}

export function PixelSeparator({ position = 'top', color = 'fill-slate-900' }: { position?: 'top' | 'bottom', color?: string }) {
    return (
        <div className={`absolute left-0 w-full overflow-hidden leading-none z-10 ${position === 'top' ? 'top-0' : 'bottom-0'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none" className={`relative block w-full h-[40px] md:h-[60px] ${color}`}>
                <rect x="0" y="0" width="1200" height="120" opacity="0" />
                <rect x="0" y="60" width="100" height="60" />
                <rect x="100" y="30" width="100" height="90" />
                <rect x="200" y="90" width="100" height="30" />
                <rect x="300" y="45" width="100" height="75" />
                <rect x="400" y="75" width="100" height="45" />
                <rect x="500" y="15" width="100" height="105" />
                <rect x="600" y="60" width="100" height="60" />
                <rect x="700" y="30" width="100" height="90" />
                <rect x="800" y="90" width="100" height="30" />
                <rect x="900" y="45" width="100" height="75" />
                <rect x="1000" y="15" width="100" height="105" />
                <rect x="1100" y="60" width="100" height="60" />
            </svg>
        </div>
    )
}

export function SkewSeparator({ position = 'top', color = 'fill-slate-900' }: { position?: 'top' | 'bottom', color?: string }) {
    return (
        <div className={`absolute left-0 w-full overflow-hidden leading-none z-10 ${position === 'top' ? 'top-0' : 'bottom-0'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none" className={`relative block w-full h-[60px] md:h-[100px] ${color}`}>
                <path d="M1200 0L0 0 598.97 114.72 1200 0z"></path>
            </svg>
        </div>
    )
}
