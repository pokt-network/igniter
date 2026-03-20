import Link from 'next/link';
import {ComponentType} from "react";
import {PlaceholderLogo} from "@igniter/ui/assets";
import { PocketBrandLogo } from "@igniter/ui/components/PocketBrandLogo";
import EngagementLinks from "@/app/components/EngagementLinks";
import GithubIcon from "@/app/assets/icons/dark/socials/github.svg";
import DiscordIcon from "@/app/assets/icons/dark/socials/discord.svg";
import XIcon from "@/app/assets/icons/dark/socials/x.svg";
import CurrentUser from "@/app/components/CurrentUser";

export interface HeaderProps {
    logoIcon?: ComponentType;
}

export default function Heading({ logoIcon: LogoIcon }: Readonly<HeaderProps>) {
    return (
        <div className="flex flex-row items-center px-[24px] justify-between w-full h-[80px] bg-bg-surface border-t border-border-primary">
            <div className="flex flex-row gap-10">
                { LogoIcon ? <LogoIcon /> : <PocketBrandLogo /> }
                <nav className="flex flex-row items-center gap-6">
                    {/*<Link href="/about">*/}
                    {/*    About*/}
                    {/*</Link>*/}
                    {/*<Link href="/providers">*/}
                    {/*    Providers*/}
                    {/*</Link>*/}
                    {/*<Link href="/documentation">*/}
                    {/*    Documentation*/}
                    {/*</Link>*/}
                </nav>
            </div>
            <div className="flex flex-row items-center gap-10">
                <div>
                    {/*<EngagementLinks links={[*/}
                    {/*    { name: "Github", Icon: GithubIcon, url: "#" },*/}
                    {/*    { name: "Discord", Icon: DiscordIcon, url: "#" },*/}
                    {/*    { name: "X", Icon: XIcon, url: "#" },*/}
                    {/*]} />*/}
                </div>
                <CurrentUser />
            </div>
        </div>
    );
}
