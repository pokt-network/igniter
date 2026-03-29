export function exportToJson(jsonData: object, name: string) {
  const jsonString = JSON.stringify(jsonData, null, 2)
  const blob = new Blob([jsonString], {type: 'application/json'})
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
