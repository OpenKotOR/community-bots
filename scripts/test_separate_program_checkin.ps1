$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"
$target = "/K1/k1_win_amazongames_swkotor.exe"
$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
function Escape-JsonString([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\\', '\\\\').Replace('"', '\\"').Replace("`r", '\\r').Replace("`n", '\\n').Replace("`t", '\\t')
}
$code = @'
from java.lang import Object as JavaObject
from ghidra.util.task import TaskMonitor
from ghidra.framework.data import DefaultCheckinHandler
from ghidra.program.model.symbol import SourceType

result = {}
df = currentProgram.getDomainFile()
consumer = JavaObject()
p2 = None
try:
    p2 = df.getDomainObject(consumer, True, False, monitor)
except Exception as e:
    result["open_error"] = str(e)

if p2 is not None:
    result["opened"] = True
    result["same_object"] = (p2 is currentProgram)
    result["class"] = str(p2.getClass())
    try:
        result["can_save"] = bool(p2.canSave())
    except Exception as e:
        result["can_save"] = "ERR:" + str(e)

    addr = p2.getAddressFactory().getAddress("004084b0")
    fn = p2.getFunctionManager().getFunctionAt(addr)
    result["name_before"] = None if fn is None else str(fn.getName())

    tx_id = p2.startTransaction("separate-program-rename")
    try:
        if fn is not None:
            fn.setName("HandleWMCharMessage", SourceType.USER_DEFINED)
    finally:
        p2.endTransaction(tx_id, True)

    fn2 = p2.getFunctionManager().getFunctionAt(addr)
    result["name_after"] = None if fn2 is None else str(fn2.getName())

    try:
        p2.getDomainFile().save(TaskMonitor.DUMMY)
        result["save_ok"] = True
    except Exception as save_exc:
        result["save_error"] = str(save_exc)
        try:
            p2.forceLock(False, "separate-program-save")
            p2.getDomainFile().save(TaskMonitor.DUMMY)
            result["save_ok_after_force_lock"] = True
        except Exception as save_force_exc:
            result["save_force_error"] = str(save_force_exc)
        finally:
            try:
                p2.unlock()
            except Exception:
                pass

    try:
        cdf = p2.getDomainFile()
        result["checked_out"] = bool(cdf.isCheckedOut())
        result["can_checkin"] = bool(cdf.canCheckin())
        result["modified_since_checkout"] = bool(cdf.modifiedSinceCheckout())
    except Exception as state_exc:
        result["state_error"] = str(state_exc)

    try:
        cdf = p2.getDomainFile()
        if cdf.canCheckin():
            h = DefaultCheckinHandler("separate-program checkin test", False, False)
            cdf.checkin(h, TaskMonitor.DUMMY)
            result["checkin_ok"] = True
        else:
            result["checkin_skipped"] = "canCheckin=false"
    except Exception as ci_exc:
        result["checkin_error"] = str(ci_exc)

    try:
        p2.release(consumer)
        result["released"] = True
    except Exception as rel_exc:
        result["release_error"] = str(rel_exc)

__result__ = result
'@
$seq = @(
    @{
        name = "sync-project"
        arguments = @{
            mode = "pull"
            path = $target
            recursive = $false
            force = $true
        }
    },
    @{
        name = "checkout-program"
        arguments = @{
            program_path = $target
            exclusive = $true
        }
    },
    @{
        name = "execute-script"
        arguments = @{
            program_path = $target
            code = $code
        }
    }
)
$seqJson = $seq | ConvertTo-Json -Depth 12 -Compress
$seqPath = Join-Path $tmpDir "test-separate-program-checkin.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
& 'C:/GitHub/agentdecompile/.venv/Scripts/agentdecompile-cli.exe' --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
