param([Parameter(Mandatory = $true)][string]$ShareDirectory)

# Run on Windows to compare its WIC decoder with the Chromium/pngjs export checks.
# Emits BGRA pixel hashes; it never changes the image or requires Photos automation.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$shareManifest = Get-Content -Raw (Join-Path $ShareDirectory 'windows-pixels.json') | ConvertFrom-Json
if (@($shareManifest).Count -ne 4) { throw 'Expected all four exported PNG formats.' }
$shareResults = foreach ($shareExpected in $shareManifest) {
  $shareName = $shareExpected.file
  if ([IO.Path]::GetFileName($shareName) -ne $shareName) { throw 'Expected a PNG basename.' }
  $shareStream = [IO.File]::OpenRead((Join-Path $ShareDirectory $shareName))
  try {
    $shareDecoder = [System.Windows.Media.Imaging.PngBitmapDecoder]::new(
      $shareStream, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
      [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $shareFrame = $shareDecoder.Frames[0]
    $shareBitmap = [System.Windows.Media.Imaging.FormatConvertedBitmap]::new(
      $shareFrame, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
    $shareStride = $shareBitmap.PixelWidth * 4
    $sharePixels = New-Object byte[] ($shareStride * $shareBitmap.PixelHeight)
    $shareBitmap.CopyPixels($sharePixels, $shareStride, 0)
    $shareHasher = [Security.Cryptography.SHA256]::Create()
    try { $shareHash = [BitConverter]::ToString($shareHasher.ComputeHash($sharePixels)).Replace('-', '').ToLowerInvariant() }
    finally { $shareHasher.Dispose() }
    if ($shareBitmap.PixelWidth -ne $shareExpected.width -or $shareBitmap.PixelHeight -ne $shareExpected.height -or $shareHash -ne $shareExpected.bgraSha256) {
      throw "Windows decoded different pixels for $shareName."
    }
    [PSCustomObject]@{ file = $shareName; width = $shareBitmap.PixelWidth; height = $shareBitmap.PixelHeight; bgraSha256 = $shareHash }
  }
  finally { $shareStream.Dispose() }
}
$shareResults | ConvertTo-Json
