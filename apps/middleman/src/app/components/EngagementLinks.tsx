import {ComponentType} from "react";
import Link from "next/link";
import DOMPurify from "isomorphic-dompurify";

export interface EngagementLinksProps {
    links: {
        name: string;
        Icon: ComponentType
        url: string;
    }[];
}

export default function EngagementLinks({ links }: Readonly<EngagementLinksProps>) {
    const sanitizeUrl = (url?: string) => {
        return url ? DOMPurify.sanitize(url) : "#";
    };

    return (
        <div className="flex flex-row items-center justify-center gap-4 bg-bg-root">
            {links.map(({ name, Icon, url }) => (
                <Link key={name} href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer">
                    <Icon />
                </Link>
            ))}
        </div>
    );
}
