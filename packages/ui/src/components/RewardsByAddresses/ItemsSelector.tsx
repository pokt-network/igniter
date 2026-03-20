'use client'

import { useState } from 'react'
import { hashStringToColor } from '../BaseLineBarChart/utils'
import { clsx } from 'clsx'
import { Check, Search, X } from 'lucide-react'
import { Button } from '../button'
import { Input } from '../input'
import { toCurrencyFormat } from '../../lib/utils'

interface SearchInputProps {
  searchInput: string
  changeSearchInput: (searchInput: string) => void
}

function SearchInput({
  searchInput,
  changeSearchInput,
}: SearchInputProps) {
  return (
    <div className={'h-[30px] flex flex-row items-center gap-1 border px-2'}>
      <Search className={'stroke-1 min-w-4 w-4 h-4'} />
      <Input
        id={'search-input'}
        value={searchInput}
        onChange={(e) => changeSearchInput(e.target.value)}
        placeholder={'Search...'}
        className={'!border-none h-[28px] pl-1 pr-0 !ring-transparent placeholder:tracking-wider placeholder:text-xs text-xs overflow-visible'}
      />
      {searchInput && (
        <Button
          variant={'ghost'}
          onClick={() => changeSearchInput('')}
          className={'p-0 border-none !bg-transparent !h-[28px]'}
        >
          <X className={'stroke-2 min-w-4 w-4 h-4'} />
        </Button>
      )}
    </div>
  )
}

interface DataItem {
  id: string
  label?: string
  value: number
  color?: string
}

function getLabel({id, label}: DataItem) {
  return label ? label : id
}

interface ItemProps {
  item: DataItem
  isSelected: boolean
  onClick: () => void
}

function Item({item, isSelected, onClick}: ItemProps) {
  const color = item.color || hashStringToColor(item.id)

  return (
    <Button
      onClick={onClick}
      variant={'ghost'}
      className={'p-0 flex flex-row items-center gap-3 h-4 pr-1 border-none bg-transparent'}
    >
      <div
        className={
          clsx(
            'min-w-4 min-h-4 w-4 h-4',
            isSelected && 'flex items-center justify-center',
            !isSelected && 'border-[3px] border-[color:--divider]',
          )
        }
        style={{
          backgroundColor: isSelected ? color : undefined
        }}
      >
        {isSelected && <Check className={'stroke-[3px] text-white w-3 h-3'} />}
      </div>
      <p className={'!text-xs h-4 leading-4 min-h-4 text-left text-ellipsis font-medium overflow-hidden whitespace-nowrap tracking-wide w-full'}>
        {getLabel(item)}
      </p>
      <p className={'!text-xs font-bold font-mono text-right'}>
        {toCurrencyFormat(item.value)}
      </p>
    </Button>
  )
}

interface TopChipProps {
  top: number
  data: Array<DataItem>
  selectedItems: Array<string>
  changeSelectedItems: (items: Array<string>) => void
}

function TopChip({
  top,
  data,
  selectedItems,
  changeSelectedItems,
}: TopChipProps) {
  if (data.length < top) return null

  const areAllSelected = data.slice(0, top).every(item => selectedItems.includes(item.id)) && selectedItems.length === top

  return (
    <Button
      variant={'ghost'}
      onClick={() => {
        if (areAllSelected) return

        changeSelectedItems(
          data.slice(0, top).map(item => item.id)
        )
      }}
      className={
        clsx(
          'hover:bg-transparent border-none h-5 min-h-5 max-h-5 !text-[12px] font-mono font-medium leading-5 rounded-2xl w-12 px-0.5 pb-0 gap-0 !pt-0.5',
          areAllSelected && 'bg-pnf-blue hover:bg-pnf-blue-hover text-white font-bold'
        )
      }
    >
      <p className={'!text-[12px]'}>
        Top {top}
      </p>
    </Button>
  )
}

interface ItemsSelectorProps {
  selectedItems: Array<string>
  changeSelectedItems: (items: Array<string>) => void
  data: Array<DataItem>
}

export default function ItemsSelector({
  selectedItems,
  changeSelectedItems,
  data,
}: ItemsSelectorProps) {
  const [searchInput, setSearchInput] = useState('')

  const changeSearchInput = (searchInput: string) => {
    setSearchInput(searchInput)
  }

  const filteredData = data.filter((item) => {
    if (!searchInput) return true

    return getLabel(item).toLowerCase().includes(searchInput.toLowerCase())
  })

  const showChips = data.length >= 3

  return (
    <div className={'border border-[color:--divider] p-4 h-full w-full bg-[color:--main-background]'}>
      <SearchInput
        searchInput={searchInput}
        changeSearchInput={changeSearchInput}
      />
      {showChips && (
        <div className={'flex flex-row gap-2 items-center mt-2 h-5'}>
          {[3, 5, 10, 15].map((top) => (
            <TopChip
              key={top}
              top={top}
              selectedItems={selectedItems}
              changeSelectedItems={changeSelectedItems}
              data={data}
            />
          ))}
        </div>
      )}
      <div
        className={'overflow-y-auto grow min-h-0 flex flex-col gap-3 mt-4'}
        style={{
          height: `calc(100% - 50px ${showChips ? '- 24px' : ''})`
        }}
      >
        {filteredData.map((item) => {
          const isSelected = selectedItems.includes(item.id)
          return (
            <Item
              key={item.id}
              item={item}
              isSelected={isSelected}
              onClick={() => {
                if (isSelected) {
                  changeSelectedItems(selectedItems.filter(id => id !== item.id))
                } else {
                  changeSelectedItems([...selectedItems, item.id])
                }
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
