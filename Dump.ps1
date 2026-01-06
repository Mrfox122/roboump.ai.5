# --- CONFIGURATION ---
$outputFile = "code_dump.txt"
# Add the file types you want to capture here
$extensions = @(".java", ".xml", ".json", ".html", ".css", ".js", ".sql", ".properties", ".txt")
# Add folders you want to ignore here
$ignoredFolders = @(".git", "target", "build", ".idea", ".vscode", "node_modules")

# --- SCRIPT ---
$currentPath = Get-Location
Write-Host "Scanning $currentPath ..."

# Clear or create the output file
Set-Content -Path $outputFile -Value ""

# Get all files recursively
$files = Get-ChildItem -Path . -Recurse -File

foreach ($file in $files) {
    # 1. Skip if it's the output file itself or the script itself
    if ($file.Name -eq $outputFile -or $file.Name -eq "dump.ps1") { continue }

    # 2. Check extensions
    if ($extensions -notcontains $file.Extension) { continue }

    # 3. Check ignored folders
    $skip = $false
    foreach ($ignore in $ignoredFolders) {
        if ($file.FullName.Contains("\$ignore\")) { 
            $skip = $true; break 
        }
    }
    if ($skip) { continue }

    # 4. Write to dump file
    try {
        Add-Content -Path $outputFile -Value "`n=============================================================================="
        Add-Content -Path $outputFile -Value "FILE: $($file.FullName.Replace($currentPath.Path, ''))"
        Add-Content -Path $outputFile -Value "=============================================================================="
        
        # Get content and append
        $content = Get-Content -Path $file.FullName -Raw
        Add-Content -Path $outputFile -Value $content
        
        Write-Host "Added: $($file.Name)"
    }
    catch {
        Write-Host "Could not read $($file.Name)" -ForegroundColor Red
    }
}

Write-Host "Done! All code saved to $outputFile" -ForegroundColor Green