'use client'

import React, { createContext, useEffect } from 'react'
import SuccessIcon from '../../assets/icons/dark/success_circular.svg'
import WarningIcon from '../../assets/icons/dark/warning_circular.svg'
import ErrorIcon from '../../assets/icons/dark/error_circular.svg'
import InfoIcon from '../../assets/icons/dark/info.svg'
import { Button } from '../../components/button'
import { RightArrowIcon } from '../../assets'
import { clsx } from 'clsx'

interface NotificationProps {
  id?: string;
  title?: string;
  description?: string;
  type: 'error' | 'warning' | 'info' | 'success';
  showTypeIcon?: boolean;
  entity?: {
    type: string
    id: string
  }
  content: React.ReactNode;
  actions?: Array<
    (notification: NotificationProps, removeNotification: () => void) => React.ReactNode
  >;
}

interface NotificationContextProps {
  notifications: Array<NotificationProps>
  addNotification: (notification: NotificationProps) => void
}

const NotificationsContext = createContext<NotificationContextProps>({
  notifications: [],
  addNotification: () => {}
})

export default function NotificationsProvider({children}: React.PropsWithChildren) {
  const [notifications, setNotifications] = React.useState<Array<NotificationProps>>([])
  const [index, setIndex] = React.useState(-1)

  useEffect(() => {
    if (notifications.length > 0 && index === -1) {
      setIndex(0)
    }
  }, [notifications])

  const removeNotification = (index: number) => {
    const newNotifications = [...notifications]
    newNotifications.splice(index, 1)
    setNotifications(newNotifications)

    let newIndex: number = index

    if (newNotifications.length > 0) {
      if (index === newNotifications.length) {
        newIndex = newNotifications.length - 1
      } else if (index !== 0) {
        newIndex = index - 1
      }
    } else {
      newIndex = -1
    }

    setIndex(newIndex)
  }

  let notificationsRender: React.ReactNode = null

  if (notifications.length > 0) {
    const notification = notifications[index]

    if (notification) {
      const actions = notification.actions || []
      const actionElements = actions.map((action, i) => {
        return (
          <div key={i} className={'flex gap-2'}>
            {action(notification, () => removeNotification(index))}
          </div>
        )
      })

      let contentComponent: React.ReactNode = notification.content

      if (typeof contentComponent === 'string') {
        contentComponent = (
          <p className={'!text-sm'}>
            {contentComponent}
          </p>
        )
      }

      let icon: React.ReactNode = null

      if (notification.showTypeIcon === undefined || notification.showTypeIcon) {
        // scale to have a size of 16px and the margins to get the icon centered to the div
        if (notification.type === 'error') {
          icon = <ErrorIcon className={'scale-[0.7272727273] -mt-[3px] -ml-[3px]'} />
        } else if (notification.type === 'warning') {
          icon = <WarningIcon className={'scale-[1.23076923] mt-0.5 ml-0.5'} />
        } else if (notification.type === 'info') {
          icon = <InfoIcon className={'scale-[1.14285714] mt-[1px] ml-[1px]'} />
        } else if (notification.type === 'success') {
          icon = <SuccessIcon className={'scale-[1.14285714] mt-[1px] ml-[1px]'} />
        }

        icon = (
          <div className={'!size-4 !min-w-4 !min-h-4'}>
            {icon}
          </div>
        )
      }

      let paginationAction: React.ReactNode = null, paginationInfo: React.ReactNode = null

      if (notifications.length > 1) {
        paginationAction = (
          <div className={'flex gap-2'}>
            <Button
              variant={'icon'}
              size={'icon'}
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              className={'w-[30px] px-0'}
            >
              <RightArrowIcon className={'!size-[18px] text-text-primary rotate-180'} />
            </Button>
            <Button
              variant={'icon'}
              size={'icon'}
              disabled={index === notifications.length - 1}
              onClick={() => setIndex(index + 1)}
              className={'w-[30px] px-0'}
            >
              <RightArrowIcon className={'!size-[18px] text-text-primary'} />
            </Button>
          </div>
        )

        paginationInfo = (
          <>
            <div
              className={'!size-0.5 !min-w-0.5 !min-h-0.5 bg-text-tertiary rounded-full]'}
            />
            <p className={'whitespace-nowrap text-text-tertiary !text-sm'}>{index + 1} of {notifications.length}</p>
          </>
        )
      }

      notificationsRender = (
        <div
          className={'sticky top-0 z-20 flex flex-col h-[70px] pt-5 bg-bg-root'}
        >
          <div className={'flex items-center gap-2 justify-between mx-30'}>
            <div className={'flex flex-row items-center gap-3'}>
              {icon}
              {contentComponent}
              {paginationInfo}
            </div>

            <div
              className={
                clsx(
                  'flex flex-row items-center gap-2',
                  '[&_button]:border [&_button]:border-[color:var(--button-2-border)] [&_button]:bg-bg-elevated [&_button]:h-[30px]'
                )
              }
            >
              {actionElements}
              <Button
                onClick={() => {
                  removeNotification(index)
                }}
              >
                Dismiss
              </Button>
              {paginationAction}
            </div>
          </div>
          <div
            className={
              clsx(
                '!min-h-0.5 !h-[2px] mt-[18px] w-full bg-linear-to-r',
                notification.type === 'success' && 'from-[color:#86b35e] to-[color:var(--success)]',
                notification.type === 'info' && 'from-[color:#394758] to-[color:#4d6078]',
                notification.type === 'warning' && 'from-[color:#f97834] to-[color:#f8a23e]',
                notification.type === 'error' && 'from-[color:#f97834] to-[color:#f8a23e]',
              )
            }
          />
        </div>
      )
    }
  }

  return (
    <NotificationsContext
      value={{
        notifications,
        addNotification: (notification) => {
          setNotifications((prevNotifications) => {
            const newNotifications = [...prevNotifications].filter((n) => n.id !== notification.id)
            newNotifications.push(notification)
            return newNotifications
          });
        }
      }}
    >
      {notificationsRender}
      {children}
    </NotificationsContext>
  )
}


export function useNotifications() {
  const context = React.useContext(NotificationsContext)

  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider')
  }

  return context
}
