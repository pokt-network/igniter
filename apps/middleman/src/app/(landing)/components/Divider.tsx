export interface DividerProps {
    top: number;
}

export default function Divider({ top }: Readonly<DividerProps>) {
    return (
        <div
            className="absolute w-full h-[1px] bg-border-primary left-1/2 -translate-x-1/2"
            style={{ top: `${top}px` }}
        />
    );
}
