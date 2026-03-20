import { ArrowBackIcon, XIcon } from "../assets";

export interface ActivityHeaderProps {
    onBack?: () => void;
    onClose: () => void;
    isDisabled?: boolean;
    title: string;
    subtitle: string;
}

export function ActivityHeader({
                                   onBack,
                                   title,
                                   subtitle,
                                   onClose,
                                   isDisabled,
                               }: Readonly<ActivityHeaderProps>) {
    const classes = onBack
        ? "flex flex-row items-center justify-between"
        : "flex flex-row-reverse";

    return (
        <div className="flex flex-col gap-4.5">
            <div className={classes}>
                {onBack && (
                    <span
                        className={`flex flex-row gap-4.5 items-center text-text-tertiary group ${
                            isDisabled ? "cursor-not-allowed opacity-60" : "hover:cursor-pointer"
                        }`}
                        onClick={!isDisabled ? onBack : undefined}
                    >
            <ArrowBackIcon
                className={`fill-current text-text-secondary group-hover:text-text-tertiary ${
                    isDisabled ? "cursor-not-allowed" : "hover:cursor-pointer"
                }`}
            />
            <span
                className={`text-[14px] ${
                    isDisabled ? "" : "group-hover:text-text-tertiary"
                }`}
            >
              Go Back
            </span>
          </span>
                )}

                <XIcon
                    className={`fill-current text-text-secondary ${
                        isDisabled
                            ? "cursor-not-allowed opacity-60"
                            : "hover:text-text-tertiary hover:cursor-pointer"
                    }`}
                    onClick={!isDisabled ? onClose : undefined}
                />
            </div>

            <div className="flex flex-col">
        <span className="font-[Rubik] text-[30px] font-normal leading-normal tracking-normal text-text-primary mb-2">
          {title}
        </span>
                <span className="text-[14px] font-normal leading-[1.43] text-text-tertiary">
          {subtitle}
        </span>
            </div>
        </div>
    );
}
