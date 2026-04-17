<#
.SYNOPSIS
    Test max context window for claude-opus-4.6-1m via copilot-api proxy.
    Sends progressively larger prompts until the API rejects one.

.PARAMETER BaseUrl
    Proxy URL. Default: http://localhost:4141

.PARAMETER Model
    Model to test. Default: claude-opus-4.6-1m

.PARAMETER Steps
    Token sizes to test (in thousands). Default: 100,180,200,250,300,400,500

.EXAMPLE
    .\test-context-limit.ps1
    .\test-context-limit.ps1 -Steps 200,300,500,800
#>
param(
    [string]$BaseUrl = "http://localhost:4141",
    [string]$Model = "claude-opus-4.7",
    [int[]]$Steps = @(100, 180, 200, 250, 300, 400, 500)
)

$endpoint = "$BaseUrl/v1/messages"

function New-Payload([int]$targetTokensK) {
    # ~1 token per 4 chars for English text; overshoot slightly
    $charCount = $targetTokensK * 1000 * 4
    $sentence = "The quick brown fox jumps over the lazy dog. "
    $repeatCount = [math]::Ceiling($charCount / $sentence.Length)
    $sb = [System.Text.StringBuilder]::new($charCount + $sentence.Length)
    for ($i = 0; $i -lt $repeatCount; $i++) { [void]$sb.Append($sentence) }
    $filler = $sb.ToString().Substring(0, $charCount)

    return @{
        model      = $Model
        max_tokens = 50
        messages   = @(
            @{
                role    = "user"
                content = "$filler`n`nRespond with exactly: CONTEXT_OK_$($targetTokensK)K"
            }
        )
    } | ConvertTo-Json -Depth 5 -Compress
}

Write-Host "=== Context Limit Test ===" -ForegroundColor Cyan
Write-Host "Proxy : $BaseUrl"
Write-Host "Model : $Model"
Write-Host "Steps : $($Steps -join 'K, ')K tokens"
Write-Host ""

$results = @()

foreach ($sizeK in $Steps) {
    Write-Host -NoNewline "[$($sizeK)K] Sending... " -ForegroundColor Yellow

    $body = New-Payload $sizeK
    $bodySizeMB = [math]::Round($body.Length / 1MB, 1)
    Write-Host -NoNewline "(payload: ${bodySizeMB}MB) " -ForegroundColor DarkGray

    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        $resp = Invoke-RestMethod -Uri $endpoint -Method Post -Body $body `
            -ContentType "application/json" `
            -Headers @{
                "x-api-key"         = "dummy"
                "anthropic-version" = "2023-06-01"
            } `
            -TimeoutSec 300

        $sw.Stop()
        $inputTokens  = $resp.usage.input_tokens
        $outputTokens = $resp.usage.output_tokens
        $stopReason   = $resp.stop_reason
        $text         = ($resp.content | Where-Object { $_.type -eq "text" } | Select-Object -First 1).text

        Write-Host "OK" -ForegroundColor Green -NoNewline
        Write-Host " | input=$inputTokens, output=$outputTokens, stop=$stopReason, time=$([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
        if ($text) {
            Write-Host "       response: $($text.Substring(0, [math]::Min(80, $text.Length)))" -ForegroundColor DarkGray
        }

        $results += [PSCustomObject]@{
            TargetK     = $sizeK
            Status      = "OK"
            InputTokens = $inputTokens
            TimeSec     = [math]::Round($sw.Elapsed.TotalSeconds, 1)
            Error       = $null
        }
    }
    catch {
        $sw.Stop()
        $errMsg = $_.Exception.Message
        $statusCode = $null
        $errBody = $null

        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $errBody = $reader.ReadToEnd()
                $reader.Close()
            } catch {}
        }

        Write-Host "FAIL" -ForegroundColor Red -NoNewline
        Write-Host " | status=$statusCode, time=$([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
        Write-Host "       error: $errMsg" -ForegroundColor DarkGray
        if ($errBody) {
            Write-Host "       body:  $($errBody.Substring(0, [math]::Min(200, $errBody.Length)))" -ForegroundColor DarkGray
        }

        $results += [PSCustomObject]@{
            TargetK     = $sizeK
            Status      = "FAIL ($statusCode)"
            InputTokens = $null
            TimeSec     = [math]::Round($sw.Elapsed.TotalSeconds, 1)
            Error       = $errMsg.Substring(0, [math]::Min(100, $errMsg.Length))
        }
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

# Find the boundary
$lastOK = $results | Where-Object { $_.Status -eq "OK" } | Select-Object -Last 1
$firstFail = $results | Where-Object { $_.Status -ne "OK" } | Select-Object -First 1

if ($lastOK -and $firstFail) {
    Write-Host "Context limit is between $($lastOK.TargetK)K and $($firstFail.TargetK)K tokens" -ForegroundColor Yellow
    Write-Host "Last successful input_tokens: $($lastOK.InputTokens)" -ForegroundColor Green
} elseif (-not $firstFail) {
    Write-Host "All steps passed! Max tested: $($lastOK.TargetK)K ($($lastOK.InputTokens) input tokens)" -ForegroundColor Green
    Write-Host "Try larger steps to find the limit." -ForegroundColor Yellow
} else {
    Write-Host "All steps failed. Check proxy is running at $BaseUrl" -ForegroundColor Red
}
