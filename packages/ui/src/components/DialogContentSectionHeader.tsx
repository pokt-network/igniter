interface DialogContentSectionHeaderProps {
    text: string;
}

export default function DialogContentSectionHeader({text}: Readonly<DialogContentSectionHeaderProps>) {
    return (
        <span className="font-sans text-[10px] text-text-tertiary uppercase">
          {text}
        </span>
    );
}
