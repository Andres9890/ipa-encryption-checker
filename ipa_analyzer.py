# This python script was provided by norep on discord (credit to him)
import os
import glob
import shutil
import zipfile
import hashlib
import plistlib
import json
import sys
import argparse
import macholib.mach_o
import macholib.MachO
from rich.console import Console
from rich.table import Table

console = Console()
EXTRACT_DIR = "./tmp/extracted/classifier"

def extract_ipa(ipa_file_path: str) -> str:
    if os.path.exists(EXTRACT_DIR): 
        shutil.rmtree(EXTRACT_DIR)
    os.makedirs(EXTRACT_DIR, exist_ok=True)

    console.log(f"Extracting IPA {ipa_file_path}")
    # IPAs are just zip files, I can open them with zipfile
    with zipfile.ZipFile(ipa_file_path, 'r') as ipa_zip:
        ipa_zip.extractall(EXTRACT_DIR)

    return EXTRACT_DIR

def get_properties(extract_dir: str):
    console.log("Reading app metadata...")
    info_plist = glob.glob(os.path.join(extract_dir, "Payload", "*.app", 'Info.plist'))

    if not info_plist:
        console.log("Error: Malformed IPA: .app directory not found")
        return None
    
    info_plist = info_plist[0]

    with open(info_plist, "rb") as plist:
        plist_data = plistlib.load(plist)
        # some older iPhoneOS 2.0 ipa properties are missing the MinimumOSVersion
        # this isn't written to actual Info.plist, just to the plist in memory so the script doesn't freak out
        if plist_data.get("MinimumOSVersion") is None:
            plist_data["MinimumOSVersion"] = "2.0"
        return plist_data

def get_cryptid(filename: str) -> bool:
    # read the mach-o headers
    macho = macholib.MachO.MachO(filename)
    for header in macho.headers:
        load_commands = header.commands
        for load_command in load_commands:
            if isinstance(load_command[1], macholib.mach_o.encryption_info_command):
                # encrypted :(
                if load_command[1].cryptid == 0:
                    return False
            if isinstance(load_command[1], macholib.mach_o.encryption_info_command_64):
                # encrypted :( (64-bit cryptid)
                if load_command[1].cryptid == 0:
                    return False
        return True

def get_architecture(filename: str) -> str:
    # thanks to https://iphonedev.wiki/Mach-O_File_Format#CPU_Type
    macho = macholib.MachO.MachO(filename)
    supports_32 = False
    supports_64 = False

    for header in macho.headers:
        if header.header.cputype == 16777228: # ARM64
            supports_64 = True
        if header.header.cputype == 12: # ARMv7 and ARMv7s(hopefully ?)
            supports_32 = True
            
    if supports_32 and supports_64:
        return "Universal"
    elif supports_64:
        return "64-bit"
    else:
        return "32-bit"

def analyze_ipa(ipa_file_path: str) -> dict:
    try:
        extract_dir = extract_ipa(ipa_file_path)
        properties = get_properties(extract_dir)
        
        if not properties:
            return {"error": "Failed to read IPA properties"}
            
        exec_name = properties.get("CFBundleExecutable")
        macho_file = glob.glob(os.path.join(extract_dir, "Payload", "*.app", exec_name))[0]
        is_encrypted = get_cryptid(macho_file)
        architecture = get_architecture(macho_file)
        
        # Calculate MD5 hash of IPA file
        md5_hash = hashlib.md5(open(ipa_file_path, 'rb').read()).hexdigest()
        
        # Generate Obscura filename format
        display_name = properties.get('CFBundleDisplayName', properties.get('CFBundleName', 'Unknown'))
        bundle_id = properties.get('CFBundleIdentifier', 'unknown')
        version = properties.get('CFBundleVersion', '1.0')
        min_ios = properties.get('MinimumOSVersion', '2.0')
        
        obscura_filename = f"{display_name}-({bundle_id})-{version}-(iOS_{min_ios})-{md5_hash}.ipa"
        
        return {
            "appName": properties.get("CFBundleName", "Unknown"),
            "displayName": display_name,
            "bundleId": bundle_id,
            "appVersion": version,
            "minIOS": min_ios,
            "architecture": architecture,
            "encrypted": is_encrypted,
            "obscuraFilename": obscura_filename,
            "md5": md5_hash
        }
    except Exception as e:
        console.print_exception()
        return {"error": str(e)}

def print_table(results):
    table = Table(title=results["displayName"])
    table.add_column("Property")
    table.add_column("Value")
    table.add_row("Name", results["appName"])
    table.add_row("Display Name", results["displayName"])
    table.add_row("Identifier", results["bundleId"])
    table.add_row("Version", results["appVersion"])
    table.add_row("Target iOS", results["minIOS"])
    table.add_row("Architecture", results["architecture"])
    table.add_row("Encrypted", "[bold red]YES" if results["encrypted"] else "[bold green]NO")
    console.print(table)
    console.log(f"Obscura-format filename: \n{results['obscuraFilename']}")

def main():
    parser = argparse.ArgumentParser(description='Analyze iOS IPA files for encryption')
    parser.add_argument('ipa_path', help='Path to the IPA file')
    parser.add_argument('--json', action='store_true', help='Output results as JSON')
    parser.add_argument('--output', '-o', help='Save results to specified JSON file')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.ipa_path):
        console.log(f"[bold red]Error:[/] IPA file not found at {args.ipa_path}")
        sys.exit(1)
        
    results = analyze_ipa(args.ipa_path)
    
    if "error" in results:
        console.log(f"[bold red]Error analyzing IPA:[/] {results['error']}")
        sys.exit(1)
    
    # Save to file if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        console.log(f"Results saved to {args.output}")
    
    # Print results
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_table(results)

if __name__ == "__main__":
    main()
# This python script was provided by norep on discord (credit to him)
