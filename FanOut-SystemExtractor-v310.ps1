#Requires -Version 5.1
<#
.SYNOPSIS
    Advanced Fan-Out System Data Extractor — Bird View to Ground Zero
.DESCRIPTION
    Extracts ALL system information using a Fan-Out parallel data flow architecture.
    Data flows from a single Angle-One entry point, fans out across multiple
    parallel collection agents, then converges into a structured output report.

    FAN-OUT STRUCTURE:
    [Angle-One Entry] --> [Fan-Out Dispatcher]
                               |
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                     ▼
    [System Agent]     [Network Agent]      [Security Agent]
    [Process Agent]    [Storage Agent]      [Services Agent]
    [Hardware Agent]   [User Agent]         [Event Agent]
          |                    |                     |
          └────────────────────┼─────────────────────┘
                               ▼
                     [Convergence Engine]
                               |
                               ▼
                     [Ground Zero Output]
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"
$WarningPreference = "SilentlyContinue"

# ═══════════════════════════════════════════════════════════════════
#  GLOBAL CONFIGURATION — ANGLE ONE ENTRY POINT
# ═══════════════════════════════════════════════════════════════════
$Global:Config = @{
    ScriptVersion   = "3.1.0"
    StartTime       = Get-Date
    OutputDir       = "$env:USERPROFILE\Desktop\SystemExtract_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    MaxRunspaces    = 8          # Fan-out worker pool size
    TimeoutSeconds  = 120        # Per-agent timeout
    EnableParallel  = $true      # Toggle fan-out parallelism
    Verbosity       = "Full"     # Full | Summary | Minimal
    ExportFormats   = @("JSON","CSV","HTML","TXT")
}

$Global:FanOutResults   = [System.Collections.Concurrent.ConcurrentDictionary[string,object]]::new()
$Global:FanOutStatus    = [System.Collections.Concurrent.ConcurrentDictionary[string,string]]::new()
$Global:FanOutErrors    = [System.Collections.Concurrent.ConcurrentBag[string]]::new()
$Global:RunspacePool    = $null

# ═══════════════════════════════════════════════════════════════════
#  VISUAL ENGINE
# ═══════════════════════════════════════════════════════════════════
function Write-Banner {
    $banner = @"

  ╔══════════════════════════════════════════════════════════════════╗
  ║       FAN-OUT SYSTEM EXTRACTOR  ★  Bird View → Ground Zero      ║
  ║                    Angle-One Entry Point                         ║
  ║              Data Flow: Parallel Fan-Out Architecture            ║
  ╚══════════════════════════════════════════════════════════════════╝
"@
    Write-Host $banner -ForegroundColor Cyan
}

function Write-Phase {
    param([string]$Phase, [string]$Detail = "", [string]$Color = "Yellow")
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "  [$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "► $Phase" -ForegroundColor $Color -NoNewline
    if ($Detail) { Write-Host "  →  $Detail" -ForegroundColor White }
    else { Write-Host "" }
}

function Write-AgentStatus {
    param([string]$Agent, [string]$Status, [string]$Color = "Green")
    Write-Host "         [AGENT] " -ForegroundColor DarkCyan -NoNewline
    Write-Host "$Agent".PadRight(22) -ForegroundColor White -NoNewline
    Write-Host "[$Status]" -ForegroundColor $Color
}

function Write-FanOutDiagram {
    param([string[]]$Agents)
    Write-Host ""
    Write-Host "  ┌─ ANGLE ONE ─── Fan-Out Dispatcher ───────────────────┐" -ForegroundColor DarkYellow
    for ($i = 0; $i -lt $Agents.Count; $i += 3) {
        $row = $Agents[$i..[math]::Min($i+2, $Agents.Count-1)]
        $line = "  │"
        foreach ($a in $row) {
            $line += "  [$($a.PadRight(14))]"
        }
        Write-Host $line -ForegroundColor Cyan
    }
    Write-Host "  └──────────────── Convergence → Ground Zero ───────────┘" -ForegroundColor DarkYellow
    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════
#  ANGLE ONE — SINGLE ENTRY POINT (DATA SOURCE INITIALIZER)
# ═══════════════════════════════════════════════════════════════════
function Initialize-AngleOne {
    Write-Phase "ANGLE ONE" "Initializing entry point & validating environment" "Magenta"

    $angleOne = @{
        Timestamp       = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Hostname        = $env:COMPUTERNAME
        CurrentUser     = "$env:USERDOMAIN\$env:USERNAME"
        PSVersion       = $PSVersionTable.PSVersion.ToString()
        OSBuild         = [System.Environment]::OSVersion.VersionString
        IsAdmin         = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        WorkingDir      = $PWD.Path
        ScriptPID       = $PID
        Culture         = [System.Globalization.CultureInfo]::CurrentCulture.Name
        TimeZone        = [System.TimeZoneInfo]::Local.DisplayName
        EntryGUID       = [System.Guid]::NewGuid().ToString()
    }

    $Global:FanOutResults["AngleOne"] = $angleOne

    Write-AgentStatus "AngleOne" "INITIALIZED" "Green"
    Write-Host "         Host: $($angleOne.Hostname)  |  User: $($angleOne.CurrentUser)  |  Admin: $($angleOne.IsAdmin)" -ForegroundColor Gray
    Write-Host "         GUID: $($angleOne.EntryGUID)" -ForegroundColor DarkGray
    return $angleOne
}

# ═══════════════════════════════════════════════════════════════════
#  FAN-OUT AGENT DEFINITIONS
#  Each agent is a self-contained scriptblock executed in parallel
# ═══════════════════════════════════════════════════════════════════

$Script:AgentRegistry = [ordered]@{

    # ── AGENT 1: SYSTEM CORE ────────────────────────────────────────
    "SystemCore" = {
        $d = @{}
        $cs  = Get-CimInstance Win32_ComputerSystem
        $os  = Get-CimInstance Win32_OperatingSystem
        $bios= Get-CimInstance Win32_BIOS
        $tz  = Get-CimInstance Win32_TimeZone

        $d["ComputerSystem"] = @{
            Manufacturer    = $cs.Manufacturer
            Model           = $cs.Model
            TotalRAM_GB     = [math]::Round($cs.TotalPhysicalMemory/1GB, 2)
            LogicalProcs    = $cs.NumberOfLogicalProcessors
            PhysicalProcs   = $cs.NumberOfProcessors
            SystemType      = $cs.SystemType
            PartOfDomain    = $cs.PartOfDomain
            Domain          = $cs.Domain
            Workgroup       = $cs.Workgroup
        }
        $d["OperatingSystem"] = @{
            Caption         = $os.Caption
            Version         = $os.Version
            BuildNumber     = $os.BuildNumber
            ServicePack     = $os.ServicePackMajorVersion
            Architecture    = $os.OSArchitecture
            InstallDate     = $os.InstallDate
            LastBoot        = $os.LastBootUpTime
            Uptime_Hours    = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 2)
            FreeRAM_GB      = [math]::Round($os.FreePhysicalMemory/1MB, 2)
            FreeVirtual_GB  = [math]::Round($os.FreeVirtualMemory/1MB, 2)
            TotalVirtual_GB = [math]::Round($os.TotalVirtualMemorySize/1MB, 2)
            SystemDrive     = $os.SystemDrive
            WindowsDir      = $os.WindowsDirectory
            RegisteredUser  = $os.RegisteredUser
            Organization    = $os.Organization
        }
        $d["BIOS"] = @{
            Manufacturer    = $bios.Manufacturer
            Name            = $bios.Name
            Version         = $bios.BIOSVersion -join " | "
            SerialNumber    = $bios.SerialNumber
            ReleaseDate     = $bios.ReleaseDate
            SMBIOSVersion   = "$($bios.SMBIOSMajorVersion).$($bios.SMBIOSMinorVersion)"
        }
        $d["TimeZone"] = @{
            Name            = $tz.Caption
            Bias_Min        = $tz.Bias
            StandardName    = $tz.StandardName
        }
        return $d
    }

    # ── AGENT 2: CPU & HARDWARE ─────────────────────────────────────
    "Hardware" = {
        $d = @{}
        $cpus = Get-CimInstance Win32_Processor
        $d["CPUs"] = @($cpus | ForEach-Object {
            $archMap = switch($_.Architecture){
                0{"x86"} 1{"MIPS"} 2{"Alpha"} 3{"PowerPC"}
                5{"ARM"}  6{"ia64"} 9{"x64"}  default{"Unknown"}
            }
            @{
                Name            = $_.Name
                Manufacturer    = $_.Manufacturer
                Cores           = $_.NumberOfCores
                LogicalProcs    = $_.NumberOfLogicalProcessors
                MaxClockMHz     = $_.MaxClockSpeed
                CurrentMHz      = $_.CurrentClockSpeed
                LoadPercent     = $_.LoadPercentage
                L2Cache_KB      = $_.L2CacheSize
                L3Cache_KB      = $_.L3CacheSize
                Architecture    = $archMap
                Socket          = $_.SocketDesignation
                Status          = $_.Status
                VirtualizationEnabled = $_.VirtualizationFirmwareEnabled
            }
        })

        $ram = Get-CimInstance Win32_PhysicalMemory
        $d["MemoryModules"] = @($ram | ForEach-Object {
            $ffMap = switch($_.FormFactor){
                8  {"DIMM"} 12 {"SO-DIMM"} 13 {"SODIMM"} default {$_.FormFactor}
            }
            @{
                BankLabel       = $_.BankLabel
                DeviceLocator   = $_.DeviceLocator
                Capacity_GB     = [math]::Round($_.Capacity/1GB, 2)
                Speed_MHz       = $_.Speed
                MemoryType      = $_.MemoryType
                Manufacturer    = $_.Manufacturer
                PartNumber      = $_.PartNumber
                SerialNumber    = $_.SerialNumber
                FormFactor      = $ffMap
            }
        })

        $gpu = Get-CimInstance Win32_VideoController
        $d["GPUs"] = @($gpu | ForEach-Object {
            @{
                Name            = $_.Caption
                DriverVersion   = $_.DriverVersion
                DriverDate      = $_.DriverDate
                VRAM_GB         = [math]::Round($_.AdapterRAM/1GB, 2)
                Resolution      = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)"
                RefreshRate_Hz  = $_.CurrentRefreshRate
                BitsPerPixel    = $_.CurrentBitsPerPixel
                VideoMode       = $_.VideoModeDescription
                Status          = $_.Status
            }
        })

        $monitors = Get-CimInstance WmiMonitorID -Namespace root/wmi
        $d["Monitors"] = @($monitors | ForEach-Object {
            $mfg = ($_.ManufacturerName | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join ""
            $prod = ($_.ProductCodeID | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join ""
            @{ Manufacturer = $mfg; ProductCode = $prod; SerialNumber = (($_.SerialNumberID | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join "") }
        })

        $mobo = Get-CimInstance Win32_BaseBoard
        $d["Motherboard"] = @{
            Manufacturer    = $mobo.Manufacturer
            Product         = $mobo.Product
            SerialNumber    = $mobo.SerialNumber
            Version         = $mobo.Version
        }
        return $d
    }

    # ── AGENT 3: STORAGE & DISKS ────────────────────────────────────
    "Storage" = {
        $d = @{}
        $disks = Get-CimInstance Win32_DiskDrive
        $d["PhysicalDisks"] = @($disks | ForEach-Object {
            @{
                Model           = $_.Model
                InterfaceType   = $_.InterfaceType
                MediaType       = $_.MediaType
                Size_GB         = [math]::Round($_.Size/1GB, 2)
                Partitions      = $_.Partitions
                SerialNumber    = $_.SerialNumber
                FirmwareRev     = $_.FirmwareRevision
                Status          = $_.Status
                BytesPerSector  = $_.BytesPerSector
                DeviceID        = $_.DeviceID
            }
        })

        $vols = Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -in 2,3,4,5}
        $d["LogicalVolumes"] = @($vols | ForEach-Object {
            $dtMap = switch($_.DriveType){
                2{"Removable"} 3{"Local"} 4{"Network"} 5{"CD-ROM"} default{"Unknown"}
            }
            @{
                Drive           = $_.DeviceID
                Label           = $_.VolumeName
                FileSystem      = $_.FileSystem
                Size_GB         = [math]::Round($_.Size/1GB, 2)
                FreeSpace_GB    = [math]::Round($_.FreeSpace/1GB, 2)
                UsedSpace_GB    = [math]::Round(($_.Size - $_.FreeSpace)/1GB, 2)
                UsedPercent     = if($_.Size -gt 0){[math]::Round((($_.Size-$_.FreeSpace)/$_.Size)*100,1)}else{0}
                DriveType       = $dtMap
                Compressed      = $_.Compressed
                SupportsQuotas  = $_.SupportsQuotas
            }
        })

        $partitions = Get-CimInstance Win32_DiskPartition
        $d["Partitions"] = @($partitions | ForEach-Object {
            @{
                Name            = $_.Name
                Type            = $_.Type
                Size_GB         = [math]::Round($_.Size/1GB, 2)
                StartOffset     = $_.StartingOffset
                Bootable        = $_.Bootable
                PrimaryPartition= $_.PrimaryPartition
                DiskIndex       = $_.DiskIndex
            }
        })

        # Page/Swap files
        $pf = Get-CimInstance Win32_PageFileUsage
        $d["PageFiles"] = @($pf | ForEach-Object {
            @{ Path = $_.Name; AllocBase_MB = $_.AllocatedBaseSize; CurrentUsage_MB = $_.CurrentUsage; PeakUsage_MB = $_.PeakUsage }
        })

        return $d
    }

    # ── AGENT 4: NETWORK ────────────────────────────────────────────
    "Network" = {
        $d = @{}
        $adapters = Get-CimInstance Win32_NetworkAdapter | Where-Object {$_.PhysicalAdapter -eq $true}
        $configs  = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object {$_.IPEnabled -eq $true}

        $d["Adapters"] = @($adapters | ForEach-Object {
            $speedVal = if($_.Speed){[math]::Round($_.Speed/1MB,0)}else{"N/A"}
            @{
                Name            = $_.Name
                MACAddress      = $_.MACAddress
                Speed_Mbps      = $speedVal
                ConnectionStatus= $_.NetConnectionStatus
                AdapterType     = $_.AdapterType
                Manufacturer    = $_.Manufacturer
                DeviceID        = $_.DeviceID
            }
        })

        $d["IPConfigurations"] = @($configs | ForEach-Object {
            @{
                Description     = $_.Description
                IPAddress       = $_.IPAddress -join " | "
                SubnetMask      = $_.IPSubnet -join " | "
                DefaultGateway  = $_.DefaultIPGateway -join " | "
                DNS             = $_.DNSServerSearchOrder -join " | "
                DHCPEnabled     = $_.DHCPEnabled
                DHCPServer      = $_.DHCPServer
                DHCPLeaseExpiry = $_.DHCPLeaseExpires
                MACAddress      = $_.MACAddress
                MTU             = $_.MTU
                WINSPrimary     = $_.WINSPrimaryServer
            }
        })

        # Active TCP connections
        $connections = Get-NetTCPConnection | Where-Object {$_.State -eq "Established"}
        $d["ActiveConnections_Count"] = $connections.Count
        $d["ActiveConnections_TopPorts"] = @($connections | Group-Object RemotePort | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object {
            @{ RemotePort = $_.Name; Count = $_.Count }
        })

        # DNS cache
        $dns = Get-DnsClientCache | Select-Object -First 30
        $d["DNSCache_Sample"] = @($dns | ForEach-Object {
            @{ Entry = $_.Entry; RecordName = $_.RecordName; Type = $_.Type; Status = $_.Status }
        })

        # Firewall profiles
        $fw = Get-NetFirewallProfile
        $d["FirewallProfiles"] = @($fw | ForEach-Object {
            @{ Profile = $_.Name; Enabled = $_.Enabled; DefaultInbound = $_.DefaultInboundAction; DefaultOutbound = $_.DefaultOutboundAction }
        })

        # Routing table
        $routes = Get-NetRoute | Where-Object {$_.RouteMetric -lt 9000} | Select-Object -First 20
        $d["RoutingTable_Sample"] = @($routes | ForEach-Object {
            @{ Destination = $_.DestinationPrefix; NextHop = $_.NextHop; Metric = $_.RouteMetric; Interface = $_.InterfaceAlias }
        })

        # Wi-Fi profiles
        $wifiProfiles = (netsh wlan show profiles 2>$null) -match "All User Profile" | ForEach-Object { ($_ -split ":")[1].Trim() }
        $d["WiFiProfiles"] = $wifiProfiles

        return $d
    }

    # ── AGENT 5: PROCESSES ──────────────────────────────────────────
    "Processes" = {
        $d = @{}
        $procs = Get-Process | Sort-Object CPU -Descending

        $d["Summary"] = @{
            TotalCount      = $procs.Count
            TotalCPU        = [math]::Round(($procs | Measure-Object CPU -Sum).Sum, 2)
            TotalMemory_MB  = [math]::Round(($procs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 2)
        }

        $d["TopCPU"] = @($procs | Select-Object -First 20 | ForEach-Object {
            @{
                PID             = $_.Id
                Name            = $_.Name
                CPU_Sec         = [math]::Round($_.CPU, 2)
                Memory_MB       = [math]::Round($_.WorkingSet64/1MB, 2)
                Threads         = $_.Threads.Count
                Handles         = $_.HandleCount
                StartTime       = $_.StartTime
                Path            = $_.Path
                Company         = $_.Company
                Description     = $_.Description
                Responding      = $_.Responding
            }
        })

        $d["TopMemory"] = @($procs | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 | ForEach-Object {
            @{ PID = $_.Id; Name = $_.Name; Memory_MB = [math]::Round($_.WorkingSet64/1MB,2) }
        })

        # Unique process names
        $d["UniqueProcesses"] = @($procs | Group-Object Name | Sort-Object Count -Descending | ForEach-Object {
            @{ Name = $_.Name; Count = $_.Count }
        })

        return $d
    }

    # ── AGENT 6: SERVICES ───────────────────────────────────────────
    "Services" = {
        $d = @{}
        $services = Get-Service
        $wmiSvc   = Get-CimInstance Win32_Service

        $d["Summary"] = @{
            Total       = $services.Count
            Running     = ($services | Where-Object {$_.Status -eq "Running"}).Count
            Stopped     = ($services | Where-Object {$_.Status -eq "Stopped"}).Count
            Paused      = ($services | Where-Object {$_.Status -eq "Paused"}).Count
            AutoStart   = ($wmiSvc | Where-Object {$_.StartMode -eq "Auto"}).Count
            Disabled    = ($wmiSvc | Where-Object {$_.StartMode -eq "Disabled"}).Count
        }

        $d["Running"] = @($wmiSvc | Where-Object {$_.State -eq "Running"} | Sort-Object Name | ForEach-Object {
            @{
                Name        = $_.Name
                DisplayName = $_.DisplayName
                StartMode   = $_.StartMode
                PathName    = $_.PathName
                StartUser   = $_.StartName
                Description = $_.Description
            }
        })

        $d["AutoStartStopped"] = @($wmiSvc | Where-Object {$_.StartMode -eq "Auto" -and $_.State -ne "Running"} | ForEach-Object {
            @{ Name = $_.Name; DisplayName = $_.DisplayName; State = $_.State; StartUser = $_.StartName }
        })

        return $d
    }

    # ── AGENT 7: SECURITY & USERS ───────────────────────────────────
    "Security" = {
        $d = @{}

        # Local users
        $users = Get-LocalUser
        $d["LocalUsers"] = @($users | ForEach-Object {
            @{
                Name            = $_.Name
                Enabled         = $_.Enabled
                FullName        = $_.FullName
                LastLogon       = $_.LastLogon
                PasswordExpires = $_.PasswordExpires
                PasswordRequired= $_.PasswordRequired
                PasswordLastSet = $_.PasswordLastSet
                AccountExpires  = $_.AccountExpires
                Description     = $_.Description
                SID             = $_.SID.Value
            }
        })

        # Local groups
        $groups = Get-LocalGroup
        $d["LocalGroups"] = @($groups | ForEach-Object {
            $members = Get-LocalGroupMember $_.Name -ErrorAction SilentlyContinue
            @{
                Name        = $_.Name
                Description = $_.Description
                MemberCount = $members.Count
                Members     = @($members | ForEach-Object { $_.Name })
            }
        })

        # Antivirus / Security products
        $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct
        $d["AntiVirus"] = @($av | ForEach-Object {
            $stateHex   = $_.productState.ToString("X6").Substring(2,2)
            $updateHex  = $_.productState.ToString("X6").Substring(4,2)
            $stateVal   = switch ($stateHex) {
                "10"    { "Enabled" }
                "00"    { "Disabled" }
                default { "Unknown" }
            }
            $updateVal  = switch ($updateHex) {
                "00"    { "UpToDate" }
                "10"    { "OutOfDate" }
                default { "Unknown" }
            }
            @{
                Name                     = $_.displayName
                State                    = $stateVal
                UpToDate                 = $updateVal
                PathToSignedReportingExe = $_.pathToSignedReportingExe
            }
        })

        $fw = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct
        $d["FirewallProducts"] = @($fw | ForEach-Object { @{ Name = $_.displayName } })

        # Password/Audit policy
        [void](secedit /export /cfg "$env:TEMP\secedit_out.cfg" /quiet 2>$null)
        if (Test-Path "$env:TEMP\secedit_out.cfg") {
            $policy = Get-Content "$env:TEMP\secedit_out.cfg" | Where-Object {$_ -match "MinimumPasswordLength|MaximumPasswordAge|PasswordComplexity|LockoutBadCount"}
            $d["PasswordPolicy"] = $policy
            Remove-Item "$env:TEMP\secedit_out.cfg" -Force
        }

        # Installed certificates (personal store)
        $certs = Get-ChildItem Cert:\LocalMachine\My
        $d["Certificates_LocalMachine_My"] = @($certs | ForEach-Object {
            @{
                Subject     = $_.Subject
                Thumbprint  = $_.Thumbprint
                Expiry      = $_.NotAfter
                Issuer      = $_.Issuer
                HasPrivKey  = $_.HasPrivateKey
            }
        })

        # Logged-on users via query
        $loggedOn = query user 2>$null
        $d["LoggedOnUsers_Raw"] = $loggedOn

        return $d
    }

    # ── AGENT 8: SOFTWARE & REGISTRY ────────────────────────────────
    "Software" = {
        $d = @{}
        $regPaths = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
            "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
        )

        $apps = $regPaths | ForEach-Object {
            Get-ItemProperty $_ -ErrorAction SilentlyContinue
        } | Where-Object {
            $_.DisplayName -and $_.DisplayName -notmatch "^{" -and $_.SystemComponent -ne 1
        } | Sort-Object DisplayName -Unique

        $d["InstalledApps_Count"] = $apps.Count
        $d["InstalledApps"] = @($apps | ForEach-Object {
            @{
                Name        = $_.DisplayName
                Version     = $_.DisplayVersion
                Publisher   = $_.Publisher
                InstallDate = $_.InstallDate
                InstallDir  = $_.InstallLocation
                Size_KB     = $_.EstimatedSize
                UninstallString = $_.UninstallString
            }
        })

        # Startup items
        $startupPaths = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce",
            "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce"
        )
        $startups = foreach ($path in $startupPaths) {
            if (Test-Path $path) {
                $key = Get-ItemProperty $path
                $key.PSObject.Properties | Where-Object {$_.Name -notmatch "^PS"} | ForEach-Object {
                    @{ Key = $path; Name = $_.Name; Value = $_.Value }
                }
            }
        }
        $d["StartupItems"] = @($startups)

        # Windows Features
        $features = Get-WindowsOptionalFeature -Online | Where-Object {$_.State -eq "Enabled"} | Select-Object -First 30
        $d["EnabledWindowsFeatures"] = @($features | ForEach-Object { @{ Feature = $_.FeatureName; State = $_.State } })

        # Windows Updates
        $updates = Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 20
        $d["RecentHotfixes"] = @($updates | ForEach-Object {
            @{ HotFixID = $_.HotFixID; Description = $_.Description; InstalledBy = $_.InstalledBy; InstalledOn = $_.InstalledOn }
        })

        # Environment variables
        $envVars = [System.Environment]::GetEnvironmentVariables("Machine")
        $d["SystemEnvVars"] = @($envVars.GetEnumerator() | ForEach-Object { @{ Name = $_.Key; Value = $_.Value } })

        return $d
    }

    # ── AGENT 9: EVENT LOGS ─────────────────────────────────────────
    "EventLogs" = {
        $d = @{}
        $logs = @("System","Application","Security")
        foreach ($log in $logs) {
            $events = Get-EventLog -LogName $log -Newest 50 -EntryType Error,Warning -ErrorAction SilentlyContinue
            $d[$log] = @{
                RecentIssues = @($events | Select-Object -First 15 | ForEach-Object {
                    @{
                        TimeGenerated   = $_.TimeGenerated
                        EntryType       = $_.EntryType.ToString()
                        Source          = $_.Source
                        EventID         = $_.EventID
                        Message         = $_.Message.Substring(0, [math]::Min(200,$_.Message.Length))
                    }
                })
                ErrorCount   = ($events | Where-Object {$_.EntryType -eq "Error"}).Count
                WarningCount = ($events | Where-Object {$_.EntryType -eq "Warning"}).Count
            }
        }

        # Scheduled tasks
        $tasks = Get-ScheduledTask | Where-Object {$_.State -ne "Disabled"} | Select-Object -First 40
        $d["ScheduledTasks_Active"] = @($tasks | ForEach-Object {
            @{
                TaskName    = $_.TaskName
                TaskPath    = $_.TaskPath
                State       = $_.State.ToString()
                Author      = $_.Principal.UserId
            }
        })

        return $d
    }

    # ── AGENT 10: PERFORMANCE SNAPSHOT ──────────────────────────────
    "Performance" = {
        $d = @{}

        # CPU usage via performance counter
        $cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
        $d["CPU_LoadPercent"] = $cpuLoad

        # Memory
        $os = Get-CimInstance Win32_OperatingSystem
        $d["Memory"] = @{
            Total_GB        = [math]::Round($os.TotalVisibleMemorySize/1MB, 2)
            Free_GB         = [math]::Round($os.FreePhysicalMemory/1MB, 2)
            Used_GB         = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB, 2)
            UsedPercent     = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/$os.TotalVisibleMemorySize)*100, 1)
        }

        # Disk IO (first physical disk)
        $diskPerf = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object {$_.Name -eq "_Total"}
        $d["DiskIO"] = @{
            ReadBytesPerSec     = $diskPerf.DiskReadBytesPerSec
            WriteBytesPerSec    = $diskPerf.DiskWriteBytesPersec
            TransfersPerSec     = $diskPerf.DiskTransfersPerSec
            QueueLength         = $diskPerf.AvgDiskQueueLength
        }

        # Network bytes
        $netPerf = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Select-Object -First 1
        $d["NetworkIO"] = @{
            BytesReceivedPerSec = $netPerf.BytesReceivedPerSec
            BytesSentPerSec     = $netPerf.BytesSentPerSec
            BytesTotalPerSec    = $netPerf.BytesTotalPerSec
        }

        # System uptime
        $uptime = (Get-Date) - $os.LastBootUpTime
        $d["Uptime"] = @{
            Days    = $uptime.Days
            Hours   = $uptime.Hours
            Minutes = $uptime.Minutes
            Total_Hours = [math]::Round($uptime.TotalHours, 2)
        }

        return $d
    }
}

# ═══════════════════════════════════════════════════════════════════
#  FAN-OUT DISPATCHER — PARALLEL EXECUTION ENGINE
# ═══════════════════════════════════════════════════════════════════
function Invoke-FanOut {
    param([hashtable]$AgentRegistry)

    Write-Phase "FAN-OUT DISPATCH" "Launching $($AgentRegistry.Count) parallel agents" "Cyan"
    Write-FanOutDiagram -Agents @($AgentRegistry.Keys)

    $runspacePool = [RunspaceFactory]::CreateRunspacePool(1, $Global:Config.MaxRunspaces)
    $runspacePool.Open()
    $Global:RunspacePool = $runspacePool

    $jobs = [System.Collections.Generic.List[hashtable]]::new()

    foreach ($agentName in $AgentRegistry.Keys) {
        $ps = [PowerShell]::Create()
        $ps.RunspacePool = $runspacePool
        $ps.AddScript($AgentRegistry[$agentName]) | Out-Null

        $job = @{
            Name        = $agentName
            PowerShell  = $ps
            Handle      = $ps.BeginInvoke()
            StartTime   = Get-Date
        }
        $jobs.Add($job)
        Write-AgentStatus $agentName "DISPATCHED" "Yellow"
    }

    Write-Host ""
    Write-Phase "CONVERGENCE" "Waiting for all agents to complete..." "DarkCyan"

    $timeout = [System.TimeSpan]::FromSeconds($Global:Config.TimeoutSeconds)

    foreach ($job in $jobs) {
        $elapsed = (Get-Date) - $job.StartTime
        if (-not $job.Handle.AsyncWaitHandle.WaitOne($timeout)) {
            $Global:FanOutErrors.Add("TIMEOUT: Agent '$($job.Name)' exceeded $($Global:Config.TimeoutSeconds)s")
            Write-AgentStatus $job.Name "TIMEOUT" "Red"
            continue
        }

        try {
            $result = $job.PowerShell.EndInvoke($job.Handle)
            if ($result -and $result.Count -gt 0) {
                $Global:FanOutResults[$job.Name] = $result[0]
                $elapsed = [math]::Round(((Get-Date) - $job.StartTime).TotalSeconds, 2)
                Write-AgentStatus $job.Name "COMPLETE [$($elapsed)s]" "Green"
            } else {
                $Global:FanOutResults[$job.Name] = @{ "_status" = "NoData" }
                Write-AgentStatus $job.Name "NO DATA" "DarkYellow"
            }
        } catch {
            $Global:FanOutErrors.Add("ERROR in Agent '$($job.Name)': $_")
            Write-AgentStatus $job.Name "FAILED" "Red"
        } finally {
            $job.PowerShell.Dispose()
        }
    }

    $runspacePool.Close()
    $runspacePool.Dispose()
}

# Sequential fallback (if parallelism is disabled)
function Invoke-Sequential {
    param([hashtable]$AgentRegistry)
    Write-Phase "SEQUENTIAL MODE" "Running agents one by one" "Yellow"
    foreach ($agentName in $AgentRegistry.Keys) {
        Write-AgentStatus $agentName "RUNNING" "Yellow"
        try {
            $result = & $AgentRegistry[$agentName]
            $Global:FanOutResults[$agentName] = $result
            Write-AgentStatus $agentName "DONE" "Green"
        } catch {
            $Global:FanOutErrors.Add("ERROR: $agentName — $_")
            Write-AgentStatus $agentName "ERROR" "Red"
        }
    }
}

# ═══════════════════════════════════════════════════════════════════
#  FAN-OUT HEALTH CHECK — VALIDATE STRUCTURE
# ═══════════════════════════════════════════════════════════════════
function Test-FanOutStructure {
    Write-Phase "FAN-OUT VALIDATION" "Checking structure integrity" "Magenta"
    $report = @{
        TotalAgents     = $Script:AgentRegistry.Count
        Completed       = 0
        Failed          = 0
        NoData          = 0
        HasErrors       = $Global:FanOutErrors.Count -gt 0
        DataKeys        = @()
        AgentHealth     = @{}
        OverallStatus   = "UNKNOWN"
    }

    foreach ($key in $Script:AgentRegistry.Keys) {
        if ($Global:FanOutResults.ContainsKey($key)) {
            $val = $Global:FanOutResults[$key]
            if ($val -is [hashtable] -and $val["_status"] -eq "NoData") {
                $report.NoData++
                $report.AgentHealth[$key] = "NO_DATA"
            } else {
                $report.Completed++
                $report.AgentHealth[$key] = "OK"
                $report.DataKeys += $key
            }
        } else {
            $report.Failed++
            $report.AgentHealth[$key] = "FAILED"
        }
    }

    $report.OverallStatus = if ($report.Failed -gt 0) { "DEGRADED" }
                             elseif ($report.NoData -gt 0) { "PARTIAL" }
                             else { "HEALTHY" }

    Write-Host ""
    Write-Host "  ╔═ FAN-OUT HEALTH REPORT ════════════════════════════════╗" -ForegroundColor $(if($report.OverallStatus -eq "HEALTHY"){"Green"}else{"Yellow"})
    Write-Host ("  ║  Overall Status : {0,-39}║" -f $report.OverallStatus) -ForegroundColor White
    Write-Host ("  ║  Total Agents   : {0,-39}║" -f $report.TotalAgents) -ForegroundColor White
    Write-Host ("  ║  Completed      : {0,-39}║" -f $report.Completed) -ForegroundColor White
    Write-Host ("  ║  Failed         : {0,-39}║" -f $report.Failed) -ForegroundColor White
    Write-Host ("  ║  No Data        : {0,-39}║" -f $report.NoData) -ForegroundColor White
    Write-Host ("  ║  Errors Logged  : {0,-39}║" -f $Global:FanOutErrors.Count) -ForegroundColor White
    Write-Host "  ╚════════════════════════════════════════════════════════╝" -ForegroundColor DarkGray

    foreach ($k in $report.AgentHealth.Keys) {
        $agColor = switch($report.AgentHealth[$k]){
            "OK"      { "Green" }
            "NO_DATA" { "Yellow" }
            default   { "Red" }
        }
        Write-Host ("         {0,-22} [{1}]" -f $k, $report.AgentHealth[$k]) -ForegroundColor $agColor
    }
    Write-Host ""
    return $report
}

# ═══════════════════════════════════════════════════════════════════
#  GROUND ZERO — CONVERGENCE & OUTPUT ENGINE
# ═══════════════════════════════════════════════════════════════════
function Export-GroundZero {
    param([hashtable]$ValidationReport)
    Write-Phase "GROUND ZERO" "Converging all data streams → output" "Green"

    # Create output directory
    if (-not (Test-Path $Global:Config.OutputDir)) {
        New-Item -ItemType Directory -Path $Global:Config.OutputDir -Force | Out-Null
    }

    $finalPayload = @{
        Meta = @{
            ExtractedAt     = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Host            = $env:COMPUTERNAME
            User            = "$env:USERDOMAIN\$env:USERNAME"
            ScriptVersion   = $Global:Config.ScriptVersion
            FanOutStatus    = $ValidationReport.OverallStatus
            AgentCount      = $ValidationReport.TotalAgents
            Errors          = @($Global:FanOutErrors)
            DurationSeconds = [math]::Round(((Get-Date) - $Global:Config.StartTime).TotalSeconds, 2)
        }
        AngleOne    = $Global:FanOutResults["AngleOne"]
        Data        = @{}
    }

    foreach ($key in $Global:FanOutResults.Keys) {
        if ($key -ne "AngleOne") {
            $finalPayload.Data[$key] = $Global:FanOutResults[$key]
        }
    }

    $base = "$($Global:Config.OutputDir)\SystemExtract_$($env:COMPUTERNAME)"

    # ── JSON ────────────────────────────────────────────────────────
    if ("JSON" -in $Global:Config.ExportFormats) {
        $jsonPath = "$base.json"
        $finalPayload | ConvertTo-Json -Depth 15 -Compress:$false | Set-Content -Path $jsonPath -Encoding UTF8
        Write-AgentStatus "JSON Export" "SAVED" "Green"
        Write-Host "         → $jsonPath" -ForegroundColor DarkGray
    }

    # ── CSV (flat summary) ──────────────────────────────────────────
    if ("CSV" -in $Global:Config.ExportFormats) {
        $csvPath = "$base`_Processes.csv"
        if ($finalPayload.Data["Processes"] -and $finalPayload.Data["Processes"]["TopCPU"]) {
            $finalPayload.Data["Processes"]["TopCPU"] | ForEach-Object {
                [PSCustomObject]$_
            } | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
            Write-AgentStatus "CSV Export" "SAVED" "Green"
            Write-Host "         → $csvPath" -ForegroundColor DarkGray
        }
    }

    # ── HTML REPORT ─────────────────────────────────────────────────
    if ("HTML" -in $Global:Config.ExportFormats) {
        $htmlPath = "$base`_Report.html"
        $html = New-HTMLReport -Payload $finalPayload -Validation $ValidationReport
        $html | Set-Content -Path $htmlPath -Encoding UTF8
        Write-AgentStatus "HTML Report" "SAVED" "Green"
        Write-Host "         → $htmlPath" -ForegroundColor DarkGray
    }

    # ── TXT SUMMARY ─────────────────────────────────────────────────
    if ("TXT" -in $Global:Config.ExportFormats) {
        $txtPath = "$base`_Summary.txt"
        $txt = New-TextSummary -Payload $finalPayload -Validation $ValidationReport
        $txt | Set-Content -Path $txtPath -Encoding UTF8
        Write-AgentStatus "TXT Summary" "SAVED" "Green"
        Write-Host "         → $txtPath" -ForegroundColor DarkGray
    }

    return $Global:Config.OutputDir
}

# ═══════════════════════════════════════════════════════════════════
#  HTML REPORT GENERATOR
# ═══════════════════════════════════════════════════════════════════
function New-HTMLReport {
    param($Payload, $Validation)

    $statusColor = switch ($Validation.OverallStatus) {
        "HEALTHY" { "#00ff88" }
        "PARTIAL"  { "#ffaa00" }
        default    { "#ff4444" }
    }
    $ts    = $Payload.Meta.ExtractedAt
    $host_ = $Payload.Meta.Host
    $dur   = $Payload.Meta.DurationSeconds

    $agentRows = ($Validation.AgentHealth.GetEnumerator() | ForEach-Object {
        $rowColor = switch ($_.Value) {
            "OK"      { "#00ff88" }
            "NO_DATA" { "#ffaa00" }
            default   { "#ff4444" }
        }
        "<tr><td>$($_.Key)</td><td style='color:$rowColor;font-weight:bold'>$($_.Value)</td></tr>"
    }) -join ""

    $procRows = if ($Payload.Data["Processes"] -and $Payload.Data["Processes"]["TopCPU"]) {
        ($Payload.Data["Processes"]["TopCPU"] | Select-Object -First 10 | ForEach-Object {
            "<tr><td>$($_["PID"])</td><td>$($_["Name"])</td><td>$($_["CPU_Sec"])</td><td>$($_["Memory_MB"])</td><td>$($_["Threads"])</td></tr>"
        }) -join ""
    } else { "<tr><td colspan='5'>No data</td></tr>" }

    $diskRows = if ($Payload.Data["Storage"] -and $Payload.Data["Storage"]["LogicalVolumes"]) {
        ($Payload.Data["Storage"]["LogicalVolumes"] | ForEach-Object {
            $pct = $_["UsedPercent"]
            $barColor = if($pct -gt 90){"#ff4444"} elseif($pct -gt 70){"#ffaa00"} else {"#00ff88"}
            "<tr><td>$($_["Drive"])</td><td>$($_["Label"])</td><td>$($_["FileSystem"])</td><td>$($_["Size_GB"]) GB</td><td>$($_["FreeSpace_GB"]) GB</td><td><div style='background:#333;border-radius:4px;height:16px;width:100px'><div style='background:$barColor;border-radius:4px;height:16px;width:$($pct)px'></div></div> $pct%</td></tr>"
        }) -join ""
    } else { "<tr><td colspan='6'>No data</td></tr>" }

    $os = if($Payload.Data["SystemCore"] -and $Payload.Data["SystemCore"]["OperatingSystem"]){"$($Payload.Data["SystemCore"]["OperatingSystem"]["Caption"]) (Build $($Payload.Data["SystemCore"]["OperatingSystem"]["BuildNumber"]))"}else{"N/A"}
    $cpu = if($Payload.Data["Hardware"] -and $Payload.Data["Hardware"]["CPUs"]){"$($Payload.Data["Hardware"]["CPUs"][0]["Name"])"}else{"N/A"}
    $ram = if($Payload.Data["SystemCore"] -and $Payload.Data["SystemCore"]["ComputerSystem"]){"$($Payload.Data["SystemCore"]["ComputerSystem"]["TotalRAM_GB"]) GB"}else{"N/A"}
    $uptime = if($Payload.Data["Performance"] -and $Payload.Data["Performance"]["Uptime"]){"$($Payload.Data["Performance"]["Uptime"]["Total_Hours"]) hours"}else{"N/A"}

    return @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FanOut System Extract — $host_</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0d0d0d; color: #e0e0e0; font-family: 'Consolas', 'Courier New', monospace; padding: 24px; }
  h1 { color: #00d4ff; font-size: 22px; margin-bottom: 4px; }
  h2 { color: #aaa; font-size: 13px; font-weight: normal; margin-bottom: 24px; }
  h3 { color: #00d4ff; font-size: 14px; margin: 20px 0 10px; border-bottom: 1px solid #222; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #161616; border: 1px solid #222; border-radius: 8px; padding: 16px; }
  .card .label { color: #666; font-size: 11px; margin-bottom: 6px; text-transform: uppercase; }
  .card .value { color: #fff; font-size: 18px; font-weight: bold; }
  .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; background: $statusColor; color: #000; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
  th { background: #1a1a1a; color: #00d4ff; padding: 8px 10px; text-align: left; border-bottom: 1px solid #333; }
  td { padding: 6px 10px; border-bottom: 1px solid #1a1a1a; }
  tr:hover td { background: #181818; }
  .section { background: #111; border: 1px solid #1e1e1e; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
  .flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .flow-node { background: #1a1a2e; border: 1px solid #00d4ff44; border-radius: 6px; padding: 6px 14px; font-size: 12px; color: #00d4ff; }
  .flow-arrow { color: #444; font-size: 18px; }
  .err { color: #ff6666; font-size: 11px; }
  footer { margin-top: 32px; color: #444; font-size: 11px; text-align: center; }
</style>
</head>
<body>
<h1>⚡ FAN-OUT SYSTEM EXTRACTOR — Ground Zero Report</h1>
<h2>Host: $host_  ·  Extracted: $ts  ·  Duration: $($dur)s  ·  Fan-Out Status: <span class='status-badge'>$($Validation.OverallStatus)</span></h2>

<div class="flow">
  <div class="flow-node">🔵 Angle One</div><div class="flow-arrow">→</div>
  <div class="flow-node">⚡ Fan-Out Dispatcher</div><div class="flow-arrow">→</div>
  <div class="flow-node">$($Validation.TotalAgents) Parallel Agents</div><div class="flow-arrow">→</div>
  <div class="flow-node">🔄 Convergence Engine</div><div class="flow-arrow">→</div>
  <div class="flow-node">🎯 Ground Zero</div>
</div>

<div class="grid">
  <div class="card"><div class="label">Operating System</div><div class="value" style="font-size:13px">$os</div></div>
  <div class="card"><div class="label">CPU</div><div class="value" style="font-size:12px">$cpu</div></div>
  <div class="card"><div class="label">Total RAM</div><div class="value">$ram</div></div>
  <div class="card"><div class="label">System Uptime</div><div class="value" style="font-size:14px">$uptime</div></div>
  <div class="card"><div class="label">Agents Completed</div><div class="value" style="color:#00ff88">$($Validation.Completed) / $($Validation.TotalAgents)</div></div>
  <div class="card"><div class="label">Errors</div><div class="value" style="color:$(if($Validation.HasErrors){'#ff4444'}else{'#00ff88'})">$($Global:FanOutErrors.Count)</div></div>
</div>

<div class="section">
<h3>Fan-Out Agent Health Matrix</h3>
<table><tr><th>Agent</th><th>Status</th></tr>$agentRows</table>
</div>

<div class="section">
<h3>Top Processes by CPU</h3>
<table><tr><th>PID</th><th>Name</th><th>CPU (sec)</th><th>Memory (MB)</th><th>Threads</th></tr>$procRows</table>
</div>

<div class="section">
<h3>Disk Volumes</h3>
<table><tr><th>Drive</th><th>Label</th><th>FS</th><th>Size</th><th>Free</th><th>Usage</th></tr>$diskRows</table>
</div>

$(if ($Global:FanOutErrors.Count -gt 0) {
    "<div class='section'><h3>⚠ Errors &amp; Warnings</h3>" + ($Global:FanOutErrors | ForEach-Object { "<p class='err'>$_</p>" } | Out-String) + "</div>"
})

<footer>Generated by FanOut-SystemExtractor v$($Payload.Meta.ScriptVersion) · PowerShell $($PSVersionTable.PSVersion) · $($Payload.Meta.ExtractedAt)</footer>
</body>
</html>
"@
}

# ═══════════════════════════════════════════════════════════════════
#  TEXT SUMMARY GENERATOR
# ═══════════════════════════════════════════════════════════════════
function New-TextSummary {
    param($Payload, $Validation)

    $lines = [System.Collections.Generic.List[string]]::new()
    $sep = "=" * 70

    $lines.Add($sep)
    $lines.Add("  FAN-OUT SYSTEM EXTRACTOR — GROUND ZERO SUMMARY REPORT")
    $lines.Add("  Bird View → Angle One → Fan-Out → Convergence → Ground Zero")
    $lines.Add($sep)
    $lines.Add("  Host         : $($Payload.Meta.Host)")
    $lines.Add("  Extracted At : $($Payload.Meta.ExtractedAt)")
    $lines.Add("  Duration     : $($Payload.Meta.DurationSeconds) seconds")
    $lines.Add("  Fan-Out Status: $($Validation.OverallStatus)")
    $lines.Add("  Agents Run   : $($Validation.Completed) / $($Validation.TotalAgents)")
    $lines.Add($sep)

    # System Core
    if ($Payload.Data["SystemCore"]) {
        $os = $Payload.Data["SystemCore"]["OperatingSystem"]
        $cs = $Payload.Data["SystemCore"]["ComputerSystem"]
        $lines.Add("[SYSTEM CORE]")
        $lines.Add("  OS       : $($os["Caption"]) Build $($os["BuildNumber"])")
        $lines.Add("  Uptime   : $($os["Uptime_Hours"]) hours")
        $lines.Add("  RAM      : $($cs["TotalRAM_GB"]) GB total  |  $($os["FreeRAM_GB"]) GB free")
        $lines.Add("  Domain   : $($cs["Domain"])")
        $lines.Add("")
    }

    # Performance
    if ($Payload.Data["Performance"]) {
        $perf = $Payload.Data["Performance"]
        $lines.Add("[PERFORMANCE SNAPSHOT]")
        $lines.Add("  CPU Load : $($perf["CPU_LoadPercent"])%")
        $lines.Add("  RAM Used : $($perf["Memory"]["UsedPercent"])% ($($perf["Memory"]["Used_GB"]) GB / $($perf["Memory"]["Total_GB"]) GB)")
        $lines.Add("")
    }

    # Storage
    if ($Payload.Data["Storage"] -and $Payload.Data["Storage"]["LogicalVolumes"]) {
        $lines.Add("[STORAGE]")
        foreach ($vol in $Payload.Data["Storage"]["LogicalVolumes"]) {
            $lines.Add("  $($vol["Drive"])  $($vol["Label"])  $($vol["FileSystem"])  Size:$($vol["Size_GB"])GB  Free:$($vol["FreeSpace_GB"])GB  ($($vol["UsedPercent"])% used)")
        }
        $lines.Add("")
    }

    # Network
    if ($Payload.Data["Network"] -and $Payload.Data["Network"]["IPConfigurations"]) {
        $lines.Add("[NETWORK]")
        foreach ($cfg in $Payload.Data["Network"]["IPConfigurations"]) {
            $lines.Add("  $($cfg["Description"])  IP:$($cfg["IPAddress"])  GW:$($cfg["DefaultGateway"])  DNS:$($cfg["DNS"])")
        }
        $lines.Add("  Active TCP Connections: $($Payload.Data["Network"]["ActiveConnections_Count"])")
        $lines.Add("")
    }

    # Services
    if ($Payload.Data["Services"] -and $Payload.Data["Services"]["Summary"]) {
        $svc = $Payload.Data["Services"]["Summary"]
        $lines.Add("[SERVICES]")
        $lines.Add("  Total:$($svc["Total"])  Running:$($svc["Running"])  Stopped:$($svc["Stopped"])  Auto:$($svc["AutoStart"])  Disabled:$($svc["Disabled"])")
        $lines.Add("")
    }

    # Security
    if ($Payload.Data["Security"]) {
        $lines.Add("[SECURITY]")
        $avList = $Payload.Data["Security"]["AntiVirus"]
        if ($avList) { foreach ($av in $avList) { $lines.Add("  AV: $($av["Name"]) [$($av["State"])]") } }
        $lines.Add("  Local Users: $($Payload.Data["Security"]["LocalUsers"].Count)")
        $lines.Add("")
    }

    # Fan-Out Agent Health
    $lines.Add("[FAN-OUT AGENT HEALTH]")
    foreach ($k in $Validation.AgentHealth.Keys) {
        $lines.Add("  $($k.PadRight(22)) $($Validation.AgentHealth[$k])")
    }
    $lines.Add("")

    # Errors
    if ($Global:FanOutErrors.Count -gt 0) {
        $lines.Add("[ERRORS / WARNINGS]")
        foreach ($e in $Global:FanOutErrors) { $lines.Add("  !! $e") }
        $lines.Add("")
    }

    $lines.Add($sep)
    $lines.Add("  END OF GROUND ZERO REPORT")
    $lines.Add($sep)

    return $lines -join "`n"
}

# ═══════════════════════════════════════════════════════════════════
#  MAIN ORCHESTRATOR — BIRD VIEW CONTROLLER
# ═══════════════════════════════════════════════════════════════════
function Start-BirdViewExtraction {
    Clear-Host
    Write-Banner

    Write-Phase "BIRD VIEW" "Initializing full extraction pipeline" "White"
    Write-Host "  Output  : $($Global:Config.OutputDir)" -ForegroundColor DarkGray
    Write-Host "  Workers : $($Global:Config.MaxRunspaces)  |  Timeout: $($Global:Config.TimeoutSeconds)s  |  Parallel: $($Global:Config.EnableParallel)" -ForegroundColor DarkGray
    Write-Host ""

    # STEP 1 — Angle One (initializes $Global:FanOutResults["AngleOne"])
    [void](Initialize-AngleOne)
    Write-Host ""

    # STEP 2 — Fan-Out Dispatch
    if ($Global:Config.EnableParallel) {
        Invoke-FanOut -AgentRegistry $Script:AgentRegistry
    } else {
        Invoke-Sequential -AgentRegistry $Script:AgentRegistry
    }

    Write-Host ""

    # STEP 3 — Validate Fan-Out Structure
    $validation = Test-FanOutStructure

    # STEP 4 — Ground Zero Convergence
    $outDir = Export-GroundZero -ValidationReport $validation

    # STEP 5 — Final Summary
    $duration = [math]::Round(((Get-Date) - $Global:Config.StartTime).TotalSeconds, 2)
    Write-Host ""
    Write-Host "  ╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║  ✓  EXTRACTION COMPLETE — ALL DATA SAVED SUCCESSFULLY    ║" -ForegroundColor Green
    Write-Host "  ╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ► Output Directory : $outDir" -ForegroundColor Cyan
    Write-Host "  ► Total Duration   : $duration seconds" -ForegroundColor White
    Write-Host "  ► Fan-Out Status   : $($validation.OverallStatus)" -ForegroundColor $(if($validation.OverallStatus -eq "HEALTHY"){"Green"}else{"Yellow"})
    Write-Host "  ► Agents Completed : $($validation.Completed) / $($validation.TotalAgents)" -ForegroundColor White
    Write-Host "  ► Files Saved      : JSON · CSV · HTML · TXT" -ForegroundColor White
    Write-Host ""

    # Open output folder
    if (Test-Path $outDir) {
        Start-Process explorer.exe $outDir
    }

    return @{
        OutputDir   = $outDir
        Validation  = $validation
        Duration    = $duration
    }
}

# ═══════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════════
$result = Start-BirdViewExtraction