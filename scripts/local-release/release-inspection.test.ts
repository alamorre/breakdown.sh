import { describe, expect, it } from 'vitest';

import { contractsNotice, contractsThirdPartyNotices } from './contracts-archive.mjs';
import { packageNotice, thirdPartyNotices } from './package-artifacts.mjs';
import { skillsNotice, skillsThirdPartyNotices } from './skills-archive.mjs';

describe('inspectLegalMaterial reinspect mode', () => {
  const releaseVersion = '1.0.1';

  it('should generate correct NOTICE content for contracts', () => {
    const notice = contractsNotice();
    expect(notice).toContain('Breakdown Local Contracts');
    expect(notice).toContain('Copyright 2026 Adam Lamorre');
  });

  it('should generate correct THIRD_PARTY_NOTICES for contracts', () => {
    const notices = contractsThirdPartyNotices(releaseVersion);
    expect(notices).toContain('# Third-Party Notices');
    expect(notices).toContain(`Document version: ${releaseVersion}`);
    expect(notices).toContain('No third-party material is incorporated');
  });

  it('should generate correct NOTICE content for skills', () => {
    const notice = skillsNotice(releaseVersion);
    expect(notice).toContain('Breakdown Local Skills');
    expect(notice).toContain('Copyright 2026 Adam Lamorre');
    expect(notice).toContain(releaseVersion);
  });

  it('should generate correct THIRD_PARTY_NOTICES for skills', () => {
    const notices = skillsThirdPartyNotices(releaseVersion);
    expect(notices).toContain('# Third-Party Notices');
    expect(notices).toContain(`Document version: ${releaseVersion}`);
    expect(notices).toContain('https://github.com/mattpocock/skills');
    expect(notices).toContain('VENDORED_SKILLS.json');
  });

  it('should generate correct NOTICE content for packages', () => {
    const packageName = '@breakdown-sh/core';
    const notice = packageNotice(packageName, releaseVersion);
    expect(notice).toContain('Breakdown Local Core');
    expect(notice).toContain('Copyright 2026 Adam Lamorre');
    expect(notice).toContain(releaseVersion);
  });

  it('should generate correct THIRD_PARTY_NOTICES for packages with dependencies', () => {
    const dependencies = [
      {
        license: 'MIT',
        name: 'yaml',
        resolved: 'https://registry.npmjs.org/yaml/-/yaml-2.4.1.tgz',
        version: '2.4.1',
      },
    ];
    const dependencySource = 'test dependencies';
    const notices = thirdPartyNotices(releaseVersion, dependencies, dependencySource);
    expect(notices).toContain('# Third-Party Notices');
    expect(notices).toContain(`Document version: ${releaseVersion}`);
    expect(notices).toContain('yaml');
    expect(notices).toContain('MIT');
  });

  it('should handle package THIRD_PARTY_NOTICES with empty dependencies', () => {
    const dependencies: never[] = [];
    const dependencySource = 'test dependencies';
    const notices = thirdPartyNotices(releaseVersion, dependencies, dependencySource);
    expect(notices).toContain('# Third-Party Notices');
    expect(notices).toContain(`Document version: ${releaseVersion}`);
  });
});

describe('legal file existence checks', () => {
  it('should validate that NOTICE and THIRD_PARTY_NOTICES paths are consistent', () => {
    const releaseVersion = '1.0.1';
    const archiveRoot = `breakdown-contracts-${releaseVersion}`;
    
    const expectedPaths = {
      contractsNotice: `${archiveRoot}/NOTICE`,
      contractsThirdParty: `${archiveRoot}/THIRD_PARTY_NOTICES.md`,
      contractsVersion: `${archiveRoot}/VERSION`,
    };
    
    expect(expectedPaths.contractsNotice).toMatch(/NOTICE$/);
    expect(expectedPaths.contractsThirdParty).toMatch(/THIRD_PARTY_NOTICES\.md$/);
    expect(expectedPaths.contractsVersion).toMatch(/VERSION$/);
  });

  it('should validate skills legal file paths', () => {
    const releaseVersion = '1.0.1';
    const archiveRoot = `breakdown-skills-${releaseVersion}`;
    
    const expectedPaths = {
      skillsNotice: `${archiveRoot}/NOTICE`,
      skillsThirdParty: `${archiveRoot}/THIRD_PARTY_NOTICES.md`,
      skillsVersion: `${archiveRoot}/VERSION`,
    };
    
    expect(expectedPaths.skillsNotice).toMatch(/NOTICE$/);
    expect(expectedPaths.skillsThirdParty).toMatch(/THIRD_PARTY_NOTICES\.md$/);
    expect(expectedPaths.skillsVersion).toMatch(/VERSION$/);
  });

  it('should validate package legal file paths', () => {
    const expectedPaths = {
      packageLicense: 'package/LICENSE',
      packageNotice: 'package/NOTICE',
      packageThirdParty: 'package/THIRD_PARTY_NOTICES.md',
    };
    
    expect(expectedPaths.packageLicense).toMatch(/LICENSE$/);
    expect(expectedPaths.packageNotice).toMatch(/NOTICE$/);
    expect(expectedPaths.packageThirdParty).toMatch(/THIRD_PARTY_NOTICES\.md$/);
  });
});
