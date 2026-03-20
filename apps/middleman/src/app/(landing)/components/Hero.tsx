
export default function Hero() {
    return (
        <div
            className="flex flex-row items-center justify-center w-full h-[430px] border-b border-border-primary overflow-hidden relative"
            style={{
                background: `var(--bg-input)`,
                backgroundImage: `
                    radial-gradient(circle at 20% 50%, rgba(99, 108, 237, 0.08) 0%, transparent 50%),
                    radial-gradient(circle at 80% 80%, rgba(255, 193, 7, 0.06) 0%, transparent 50%)
                `,
            }}
        >
            <div className="flex flex-col w-[519px] h-full">
                <div className="flex flex-col gap-1">
                    <span className="font-bold tracking-tight mt-[86px] text-[2.2rem] text-text-primary text-center">
                        Non-Custodial Staking
                    </span>
                    <div>
                        <span className="font-bold tracking-tight mt-[86px] text-[2.2rem] text-text-primary text-center">
                            Made Easy For
                        </span>
                        <span className="relative inline-flex items-center justify-center ml-[16px] w-[177px] h-[67px]">
                            <span
                                className="font-[var(--font-mono)] text-[50px] text-transparent bg-clip-text"
                                style={{
                                    background: `linear-gradient(135deg, var(--pnf-blue), var(--pnf-lavender))`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                }}
                            >
                                $POKT
                            </span>
                            <span
                                className="absolute w-[177px] h-[67px] opacity-15"
                                style={{
                                    background: `linear-gradient(135deg, var(--pnf-blue), var(--pnf-lavender))`,
                                }}
                            >
                            </span>
                        </span>

                    </div>
                    <span className="font-[var(--font-sans)] text-[18px] mt-[35px] leading-[1.83] text-text-secondary text-center">
                      Effortlessly stake your tokens across multiple providers using Igniter. Ignite your potential and make your tokens work for you.
                    </span>
                </div>
            </div>
        </div>
    );
}
