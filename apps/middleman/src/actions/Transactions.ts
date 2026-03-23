'use server'

import {getTransactions, getTransactionsByUser} from '@/lib/dal/transaction'
import {requireAuth, requireAdmin} from "@/lib/utils/actions";

export async function GetUserTransactions() {
  const userIdentity = await requireAuth()
  return getTransactionsByUser(userIdentity)
}

export async function GetTransactions() {
  await requireAdmin()
  return getTransactions()
}
