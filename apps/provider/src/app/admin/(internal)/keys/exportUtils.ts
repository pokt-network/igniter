export function downloadFile(content: string, name: string, mimeType: string) {
  const blob = new Blob([content], {type: mimeType})
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function exportToJson(jsonData: object, name: string) {
  downloadFile(JSON.stringify(jsonData, null, 2), name, 'application/json')
}

export function exportToRelayMinerHaYaml(keys: {hex: string; address: string}[], name: string) {
  const lines = ['keys:']
  keys.forEach((key, i) => {
    lines.push(`  # supplier${i + 1} - ${key.address}`)
    lines.push(`  - "${key.hex}"`)
  })
  downloadFile(lines.join('\n') + '\n', name, 'application/x-yaml')
}
