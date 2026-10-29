// Generates a deterministic synthetic NCR corpus, its evidence registry and a held-out eval set.
// The corpus is 195 generated NCRs plus the 5 UI historical cases from data/anchor-history.json.
// Usage: npm run data:generate   (writes data/synthetic-ncrs.json, data/evidence-registry.json, data/eval-set.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceRecord, Severity } from '../src/lib/types';
import type { AnchorFile, Area, EvalCase, SyntheticNcr } from './synthetic-types';

const SEED = 20261031;
const GENERATED = 195;
const PER_YEAR = 100;
const EVAL_SIZE = 30;

// mulberry32: small seeded PRNG, same sequence on every run.
function createRng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = createRng(SEED);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
function shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

type Bilingual = { en: readonly string[]; id: readonly string[] };
interface Family {
    code: string;
    area: Area;
    category: string;
    defectCode: string;
    title: Bilingual;
    symptom: Bilingual;
    cue: Bilingual;
    rootCause: string;
    action: string;
    evidence: readonly [prefix: string, kind: string, summary: string][];
}

// Root cause families. Families in one area share symptoms; the cue sentences carry the distinguishing signal.
const families: readonly Family[] = [
    {
        code: 'DC-VENT', area: 'Die casting', category: 'Porosity', defectCode: 'POR-01',
        title: { en: ['Porosity near last-fill area', 'Gas porosity at overflow side of housing', 'Pores at end of fill on motor housing'], id: ['Porositas di area akhir pengisian', 'Porositas dekat overflow housing', 'Pori di ujung aliran casting'] },
        symptom: { en: ['X-ray shows pore clusters at the last-to-fill zone of the housing', 'Leak test fail, sectioning shows porosity near overflow wells', 'Machined face shows open pores at end-of-fill area'], id: ['X-ray menunjukkan cluster pori di area akhir pengisian housing', 'Leak test NG, hasil potong ada porositas dekat overflow', 'Permukaan hasil machining ada pori terbuka di area ujung aliran'] },
        cue: { en: ['Die has run many shots since last vent cleaning.', 'Dark release-agent residue seen on vent area.', 'Air vents look partly closed at setup.'], id: ['Dies sdh banyak shot sejak cleaning vent terakhir.', 'Ada residu release agent hitam di area vent.', 'Vent udara keliatan setengah tertutup saat setup.'] },
        rootCause: 'Vent channels blocked by release-agent build-up, confirmed by tooling inspection.',
        action: 'Clean vents every 400 shots and add a vent check to the setup checklist.',
        evidence: [['TI', 'Tooling inspection', 'Vent channel condition on the die'], ['LAB', 'Metallography', 'Pore morphology of sectioned parts']]
    },
    {
        code: 'DC-VAC', area: 'Die casting', category: 'Porosity', defectCode: 'POR-01',
        title: { en: ['Housing voids after tool change', 'Porosity after die change', 'Internal voids in housing'], id: ['Void di housing setelah ganti dies', 'Porositas setelah tool change', 'Rongga internal pada housing'] },
        symptom: { en: ['X-ray detects internal voids spread in thick sections', 'Internal porosity found in thick boss area', 'Voids found in X-ray on several cavities'], id: ['X-ray deteksi void internal di area tebal', 'Porositas internal di area boss tebal', 'Ditemukan void di X-ray pada beberapa cavity'] },
        cue: { en: ['Started right after the die change.', 'Vacuum valve timing was re-set after tool change.', 'Vacuum level reading lower than recipe on HMI.'], id: ['Mulai muncul tepat setelah ganti dies.', 'Timing vacuum valve di-setting ulang setelah tool change.', 'Pembacaan vacuum di HMI lebih rendah dr resep.'] },
        rootCause: 'Vacuum valve timing set incorrectly after tool change, confirmed by parameter log comparison.',
        action: 'Lock the validated vacuum recipe and verify first-off samples after every tool change.',
        evidence: [['PL', 'Parameter log', 'Vacuum timing versus validated recipe'], ['FV', 'First-off verification', 'First-off X-ray after recipe lock']]
    },
    {
        code: 'DC-H2', area: 'Die casting', category: 'Porosity', defectCode: 'POR-02',
        title: { en: ['Round gas pores across casting', 'Widespread fine porosity in aluminum part', 'Fine pores all over cast cover'], id: ['Pori bulat halus di seluruh casting', 'Porositas menyebar di part aluminium', 'Pori halus merata di cover casting'] },
        symptom: { en: ['Fine round pores distributed over the whole section', 'X-ray shows scattered fine porosity, not location specific', 'Density check of samples below limit'], id: ['Pori bulat halus tersebar di seluruh penampang', 'X-ray menunjukkan porositas halus menyebar, tdk di satu lokasi', 'Cek density sampel di bawah limit'] },
        cue: { en: ['Rainy week, melt held long in furnace.', 'Degassing rotor was replaced recently.', 'Density index of melt sample high.'], id: ['Minggu hujan, molten lama ditahan di furnace.', 'Rotor degassing baru diganti.', 'Density index sampel molten tinggi.'] },
        rootCause: 'Insufficient melt degassing leading to hydrogen porosity, confirmed by density index tests.',
        action: 'Set degassing time by density index and test every furnace transfer.',
        evidence: [['LAB', 'Lab report', 'Density index of melt samples'], ['PL', 'Parameter log', 'Degassing time and rotor speed']]
    },
    {
        code: 'DC-DIETEMP', area: 'Die casting', category: 'Cold shut', defectCode: 'CLD-01',
        title: { en: ['Cold shut on thin rib', 'Flow lines and misrun on cover', 'Incomplete fill at thin wall'], id: ['Cold shut di rib tipis', 'Flow line dan misrun di cover', 'Tidak terisi penuh di dinding tipis'] },
        symptom: { en: ['Visible cold shut lines on thin ribs', 'Misrun at far end of thin wall section', 'Flow marks and laps on cosmetic face'], id: ['Garis cold shut terlihat di rib tipis', 'Misrun di ujung dinding tipis', 'Flow mark dan lap di permukaan kosmetik'] },
        cue: { en: ['Mostly on first shots after the morning restart.', 'Die heater alarm reported earlier in the shift.', 'Thermal camera shows cold spots on die.'], id: ['Kebanyakan di shot awal setelah start pagi.', 'Ada alarm heater dies di awal shift.', 'Kamera thermal menunjukkan area dingin di dies.'] },
        rootCause: 'Die temperature below window after restart, confirmed by thermocouple data.',
        action: 'Add die warm-up shots and interlock start until die temperature is in window.',
        evidence: [['PL', 'Parameter log', 'Die thermocouple data at restart'], ['TR', 'Trial report', 'Warm-up shot trial']]
    },
    {
        code: 'CNC-WEAR', area: 'CNC machining', category: 'Dimensional', defectCode: 'DIM-02',
        title: { en: ['Shaft diameter above upper tolerance', 'Bore diameter drifting out of tolerance', 'OD oversize on turned shaft'], id: ['Diameter shaft melebihi toleransi atas', 'Diameter bore drifting keluar toleransi', 'OD oversize pd shaft hasil bubut'] },
        symptom: { en: ['Diameter measured above upper limit on in-process check', 'SPC chart shows gradual upward trend in diameter', 'Final inspection finds oversize OD'], id: ['Diameter terukur di atas batas atas saat cek in-process', 'Grafik SPC menunjukkan tren naik bertahap di diameter', 'Final inspection temukan OD oversize'] },
        cue: { en: ['Trend grows over the shift until offset adjust.', 'Insert has not been changed for a long run.', 'Surface finish also getting rougher.'], id: ['Tren naik sepanjang shift sampai offset diadjust.', 'Insert blm diganti utk running yg panjang.', 'Surface finish jg makin kasar.'] },
        rootCause: 'Cutting insert wear beyond life, confirmed by measured flank wear.',
        action: 'Introduce tool-life limits and in-process gauging with automatic offset.',
        evidence: [['TI', 'Tooling inspection', 'Measured insert flank wear'], ['GR', 'Gauge study', 'Gauge R&R of the diameter gauge']]
    },
    {
        code: 'CNC-OFFSET', area: 'CNC machining', category: 'Dimensional', defectCode: 'DIM-03',
        title: { en: ['Hole position shifted after changeover', 'All parts out by constant amount', 'Wrong step length on shaft'], id: ['Posisi hole bergeser setelah changeover', 'Semua part meleset dgn nilai konstan', 'Panjang step shaft salah'] },
        symptom: { en: ['CMM shows every part shifted by the same amount', 'Position of holes out of tolerance on all parts in lot', 'Step length out of spec, same deviation every piece'], id: ['CMM menunjukkan semua part bergeser dgn nilai sama', 'Posisi hole NG di semua part dalam lot', 'Panjang step tdk sesuai spek, deviasi sama tiap pcs'] },
        cue: { en: ['Happened right after model changeover.', 'First article was not re-checked after program edit.', 'Work offset G54 was edited on night shift.'], id: ['Terjadi tepat setelah changeover model.', 'First article tdk dicek ulang setelah edit program.', 'Work offset G54 diubah di shift malam.'] },
        rootCause: 'Wrong work offset loaded at changeover, confirmed by program and offset audit.',
        action: 'Lock offsets per part number and require a first-article CMM check after changeover.',
        evidence: [['PL', 'Program log', 'Work offset history at changeover'], ['VT', 'Validation test', 'First-article CMM after correction']]
    },
    {
        code: 'CNC-THERMAL', area: 'CNC machining', category: 'Dimensional', defectCode: 'DIM-04',
        title: { en: ['Length variation morning vs afternoon', 'Dimensional shift during warm-up', 'Z length unstable'], id: ['Variasi panjang pagi vs siang', 'Dimensi bergeser saat warm-up', 'Panjang Z tdk stabil'] },
        symptom: { en: ['Z-axis length varies between start of shift and later parts', 'Parts from first hour out of tolerance, later OK', 'Length measurement unstable across the day'], id: ['Panjang sumbu Z beda antara awal shift dan part berikutnya', 'Part jam pertama NG, selanjutnya OK', 'Pengukuran panjang tdk stabil sepanjang hari'] },
        cue: { en: ['Machine started cold without warm-up program.', 'Shop temperature changed a lot this week.', 'Spindle temperature reading rises during first hour.'], id: ['Mesin start dingin tanpa program warm-up.', 'Suhu ruangan berubah banyak minggu ini.', 'Suhu spindle naik di jam pertama.'] },
        rootCause: 'Spindle thermal growth during warm-up, confirmed by temperature versus length study.',
        action: 'Run a spindle warm-up cycle and enable thermal compensation.',
        evidence: [['TR', 'Trial report', 'Temperature versus length study'], ['GR', 'Gauge study', 'Measurement system check']]
    },
    {
        code: 'CNC-CLAMP', area: 'CNC machining', category: 'Dimensional', defectCode: 'DIM-05',
        title: { en: ['Ovality on thin-wall sleeve', 'Flatness out on machined plate', 'Roundness out of spec'], id: ['Ovalitas pd sleeve dinding tipis', 'Kerataan NG pd plat machining', 'Kebulatan tdk sesuai spek'] },
        symptom: { en: ['Roundness measured out of tolerance after unclamping', 'Flatness out of spec on thin plate', 'Part springs back out of shape after release'], id: ['Kebulatan NG setelah lepas clamp', 'Kerataan di luar spek pd plat tipis', 'Part berubah bentuk setelah dilepas dr fixture'] },
        cue: { en: ['Clamp pressure was raised to stop part movement.', 'Three-jaw chuck used instead of soft jaws.', 'Distortion follows clamp points.'], id: ['Tekanan clamp dinaikkan supaya part tdk geser.', 'Pakai chuck 3 jaw bukan soft jaw.', 'Distorsi mengikuti titik clamp.'] },
        rootCause: 'Excess clamping force distorting the part, confirmed by clamp pressure trial.',
        action: 'Set a clamp pressure limit and use soft jaws for thin-wall parts.',
        evidence: [['TR', 'Trial report', 'Clamp pressure trial'], ['FP', 'Fixture photos', 'Clamp contact marks']]
    },
    {
        code: 'ASM-SEAL', area: 'Assembly', category: 'Leakage', defectCode: 'LEK-01',
        title: { en: ['Seal leak at end-of-line test', 'Leak at seal interface', 'O-ring leak on pump cover'], id: ['Bocor seal saat EOL test', 'Bocor di interface seal', 'O-ring bocor di cover pompa'] },
        symptom: { en: ['End-of-line leak test fails at seal interface', 'Air leak detected around cover seal', 'Leak rate above limit at seal groove'], id: ['Leak test EOL NG di area seal', 'Bocor udara terdeteksi di sekitar seal cover', 'Leak rate di atas limit di groove seal'] },
        // The new-operator cue is a deliberate red herring: the confirmed cause is missing error-proofing.
        cue: { en: ['Teardown shows seal twisted in groove.', 'Seal can be installed upside down.', 'New operator on station 4 this week.'], id: ['Hasil bongkar seal terpelintir di groove.', 'Seal bisa dipasang terbalik.', 'Ada operator baru di station 4 minggu ini.'] },
        rootCause: 'Seal installed in wrong orientation with no error-proofing, confirmed by teardown.',
        action: 'Add a poka-yoke locator for seal orientation and a vision check.',
        evidence: [['TD', 'Teardown', 'Teardown of leaking assemblies'], ['VT', 'Validation test', 'Leak test after locator']]
    },
    {
        code: 'ASM-TORQUE', area: 'Assembly', category: 'Fastening', defectCode: 'TRQ-01',
        title: { en: ['Loose bolts on flange', 'Low torque at cover bolts', 'Flange leak with loose fasteners'], id: ['Baut flange kendor', 'Torsi rendah di baut cover', 'Bocor flange dgn baut kendor'] },
        symptom: { en: ['Torque audit finds bolts below minimum', 'Flange leak, bolts found loose', 'Residual torque low on cover screws'], id: ['Audit torsi menemukan baut di bawah minimum', 'Flange bocor, baut ditemukan kendor', 'Torsi sisa rendah di sekrup cover'] },
        cue: { en: ['Nutrunner calibration overdue.', 'Same nutrunner spindle on all bad parts.', 'Torque readout OK on screen but audit low.'], id: ['Kalibrasi nutrunner sdh lewat jadwal.', 'Spindle nutrunner yg sama di semua part NG.', 'Torsi di layar OK tp hasil audit rendah.'] },
        rootCause: 'Nutrunner out of calibration, confirmed by torque transducer check.',
        action: 'Recalibrate nutrunners, shorten the calibration interval, and add a daily torque check.',
        evidence: [['VT', 'Validation test', 'Torque transducer check'], ['TR', 'Trial report', 'Torque audit after recalibration']]
    },
    {
        code: 'ASM-FIXTURE', area: 'Assembly', category: 'Surface finish', defectCode: 'SUR-03',
        title: { en: ['Surface scoring on drive cover', 'Scratches on cosmetic face', 'Score marks after assembly'], id: ['Goresan di cover drive', 'Baret di permukaan kosmetik', 'Bekas gores setelah assembly'] },
        symptom: { en: ['Scoring marks on cover face after assembly', 'Scratches in the same location on every part', 'Cosmetic defect at fixture contact area'], id: ['Bekas gores di permukaan cover setelah assembly', 'Baret di lokasi yg sama di tiap part', 'Cacat kosmetik di area kontak fixture'] },
        cue: { en: ['Fixture pads look worn and dirty.', 'Marks match fixture contact points.', 'Defect stops when parts are assembled by hand.'], id: ['Pad fixture keliatan aus dan kotor.', 'Bekas cocok dgn titik kontak fixture.', 'Cacat hilang kalau dirakit manual.'] },
        rootCause: 'Worn fixture contact pads, confirmed through controlled reproduction.',
        action: 'Replace fixture pads with polymer pads and add a pad wear check.',
        evidence: [['TR', 'Trial report', 'Controlled reproduction on the fixture'], ['FP', 'Fixture photos', 'Pad condition']]
    },
    {
        code: 'ASM-CONN', area: 'Assembly', category: 'Assembly', defectCode: 'ASM-04',
        title: { en: ['Connector seating failure', 'Intermittent electrical test fail', 'Connector not latched'], id: ['Konektor tdk duduk sempurna', 'Electrical test NG intermittent', 'Konektor tdk terkunci'] },
        symptom: { en: ['Electrical test fails intermittently at harness connector', 'Connector found half seated at audit', 'Pull test shows connector not latched'], id: ['Electrical test NG kadang-kadang di konektor harness', 'Konektor setengah masuk saat audit', 'Pull test menunjukkan konektor tdk terkunci'] },
        cue: { en: ['No audible click on some parts.', 'Locating pin on nest is worn.', 'Push force varies a lot between parts.'], id: ['Tdk ada bunyi klik di beberapa part.', 'Pin locating di nest aus.', 'Gaya dorong beda-beda antar part.'] },
        rootCause: 'Worn locating pin misaligning the connector, confirmed by teardown and nest measurement.',
        action: 'Replace locating pins and add a push-force monitor and pull test.',
        evidence: [['TD', 'Teardown', 'Teardown of failed connectors'], ['TI', 'Tooling inspection', 'Nest locating pin measurement']]
    },
    {
        code: 'COT-GUN', area: 'Coating', category: 'Coating', defectCode: 'COT-02',
        title: { en: ['Coating thickness below specification', 'Thin paint on one side', 'Low DFT on bracket'], id: ['Ketebalan coating di bawah spek', 'Cat tipis di satu sisi', 'DFT rendah di bracket'] },
        symptom: { en: ['DFT readings below minimum on one side of part', 'Coating thickness low and uneven', 'Thin film near edges, substrate visible'], id: ['Pembacaan DFT di bawah minimum di satu sisi part', 'Ketebalan coating rendah dan tdk rata', 'Film tipis di tepi, base material keliatan'] },
        cue: { en: ['Spray pattern looks narrow and uneven.', 'Nozzle has not been replaced for months.', 'Paint flow rate setting OK but output low.'], id: ['Pola semprot keliatan sempit dan tdk rata.', 'Nozzle blm diganti berbulan-bulan.', 'Setting flow cat OK tp output rendah.'] },
        rootCause: 'Worn spray gun nozzle giving low and uneven output, confirmed by spray pattern test.',
        action: 'Replace nozzles on a fixed interval and add a daily spray pattern check.',
        evidence: [['TR', 'Trial report', 'Spray pattern test'], ['GR', 'Gauge study', 'DFT gauge check']]
    },
    {
        code: 'COT-PRETREAT', area: 'Coating', category: 'Adhesion', defectCode: 'ADH-01',
        title: { en: ['Paint peeling after cross-cut test', 'Poor coating adhesion', 'Coating flaking on bracket'], id: ['Cat mengelupas setelah cross-cut', 'Adhesi coating jelek', 'Coating terkelupas di bracket'] },
        symptom: { en: ['Cross-cut adhesion test fails, grade 3 or worse', 'Coating flakes off at bends', 'Peeling found at customer after assembly'], id: ['Tes cross-cut gagal, grade 3 atau lebih jelek', 'Coating terkelupas di area tekukan', 'Ditemukan mengelupas di customer setelah assembly'] },
        cue: { en: ['Pretreatment bath not titrated last week.', 'Water break test shows oil on parts.', 'Bath concentration log has gaps.'], id: ['Bath pretreatment tdk dititrasi minggu lalu.', 'Water break test menunjukkan ada minyak di part.', 'Log konsentrasi bath ada yg bolong.'] },
        rootCause: 'Pretreatment bath concentration below range, confirmed by titration records.',
        action: 'Titrate the bath every shift with automatic dosing and an alarm.',
        evidence: [['LAB', 'Lab report', 'Bath titration'], ['VT', 'Validation test', 'Cross-cut after correction']]
    },
    {
        code: 'COT-CURE', area: 'Coating', category: 'Cure', defectCode: 'CUR-01',
        title: { en: ['Soft coating after curing', 'Coating fails MEK rub test', 'Under-cured powder coat'], id: ['Coating lunak setelah curing', 'Coating gagal MEK rub test', 'Powder coat kurang matang'] },
        symptom: { en: ['Film is soft and marks easily', 'MEK rub test fails below required rubs', 'Pencil hardness below spec'], id: ['Film lunak dan mudah tergores', 'MEK rub test gagal di bawah jumlah gosokan', 'Kekerasan pensil di bawah spek'] },
        cue: { en: ['Oven profile not run since burner service.', 'Conveyor speed was increased for output.', 'Heavy parts in same rack.'], id: ['Profil oven blm dicek sejak servis burner.', 'Kecepatan conveyor dinaikkan utk kejar output.', 'Part tebal di rak yg sama.'] },
        rootCause: 'Oven cure temperature below schedule, confirmed by oven profile data.',
        action: 'Run oven profiling weekly and interlock conveyor speed with oven temperature.',
        evidence: [['PL', 'Parameter log', 'Oven temperature profile'], ['TR', 'Trial report', 'Cure trial at corrected profile']]
    },
    {
        code: 'COT-HUMID', area: 'Coating', category: 'Appearance', defectCode: 'BLS-01',
        title: { en: ['Blistering on painted surface', 'Bubbles in paint film', 'Pinholes and blisters on cover'], id: ['Blister di permukaan cat', 'Gelembung di film cat', 'Pinhole dan blister di cover'] },
        symptom: { en: ['Small blisters appear on painted surface', 'Pinholes and bubbles found after curing', 'Blisters after humidity test'], id: ['Muncul blister kecil di permukaan cat', 'Ada pinhole dan gelembung setelah curing', 'Blister setelah humidity test'] },
        cue: { en: ['Booth humidity high during rainy season.', 'Compressed air dryer alarm earlier.', 'Water found in air line filter.'], id: ['Kelembapan booth tinggi di musim hujan.', 'Alarm air dryer kompresor sebelumnya.', 'Ada air di filter saluran angin.'] },
        rootCause: 'Moisture in compressed air from a failed dryer, confirmed by air line inspection.',
        action: 'Repair the air dryer, add a dew point monitor and drain filters each shift.',
        evidence: [['TI', 'Tooling inspection', 'Air line and dryer inspection'], ['TR', 'Trial report', 'Spray trial with dry air']]
    }
];

// Generic titles and symptoms say only that something is wrong in the area, as many real NCRs do.
const areaInfo: Record<Area, { lot: string; machines: readonly string[]; inspect: Bilingual; genericTitle: Bilingual; genericSymptom: Bilingual }> = {
    'Die casting': {
        lot: 'DC', machines: ['DC-01', 'DC-02', 'DC-03', 'DC-05', 'DC-06'], inspect: { en: ['X-ray'], id: ['X-ray'] },
        genericTitle: { en: ['Casting defect on housing', 'NG casting on motor housing', 'Reject on die-cast part'], id: ['Cacat casting di housing', 'Part casting NG', 'Reject di part die casting'] },
        genericSymptom: { en: ['Defect found at X-ray and visual inspection above acceptance limit', 'Parts rejected at final inspection for casting defect'], id: ['Cacat ditemukan di X-ray dan visual di atas limit', 'Part di-reject di final inspection krn cacat casting'] }
    },
    'CNC machining': {
        lot: 'CNC', machines: ['CNC-04', 'CNC-07', 'CNC-11', 'CNC-12'], inspect: { en: ['gauge check'], id: ['cek gauge'] },
        genericTitle: { en: ['Dimension out of tolerance', 'Dimensional NG on machined part', 'Out of spec on CNC part'], id: ['Dimensi di luar toleransi', 'Dimensi NG di part machining', 'Part CNC tdk sesuai spek'] },
        genericSymptom: { en: ['Measured dimension outside drawing tolerance', 'CMM report shows out-of-tolerance features'], id: ['Dimensi terukur di luar toleransi drawing', 'Laporan CMM ada fitur di luar toleransi'] }
    },
    'Assembly': {
        lot: 'AS', machines: ['line A1', 'line A2', 'line B1'], inspect: { en: ['leak and electrical test'], id: ['leak test dan electrical test'] },
        genericTitle: { en: ['Assembly reject at end of line', 'Function test fail on assembly', 'Defect found on assembled unit'], id: ['Reject assembly di end of line', 'Function test NG di assembly', 'Cacat di unit hasil rakit'] },
        genericSymptom: { en: ['Unit fails end-of-line check', 'Defect found on assembled unit during audit'], id: ['Unit gagal cek end of line', 'Cacat ditemukan di unit rakitan saat audit'] }
    },
    'Coating': {
        lot: 'CT', machines: ['booth 1', 'booth 2', 'oven line 3'], inspect: { en: ['DFT and adhesion check'], id: ['cek DFT dan adhesi'] },
        genericTitle: { en: ['Coating defect on bracket', 'Paint quality NG', 'Coating reject'], id: ['Cacat coating di bracket', 'Kualitas cat NG', 'Reject coating'] },
        genericSymptom: { en: ['Coating does not meet specification', 'Paint defect found at final inspection'], id: ['Coating tdk memenuhi spek', 'Cacat cat ditemukan di final inspection'] }
    }
};
const GENERIC_TITLE_RATE = 0.4;
const GENERIC_SYMPTOM_RATE = 0.4;
const CUE_RATE = 0.7;

const reporters: Bilingual = {
    en: ['Found at final inspection.', 'Customer complaint, 8D requested.', 'Found by QC during patrol.', 'Reported by shift 2 leader.', 'Found at incoming inspection of next process.'],
    id: ['Ditemukan saat final inspection.', 'Komplain customer, minta 8D.', 'Temuan QC patrol.', 'Dilaporkan leader shift 3.', 'Ditemukan di incoming proses berikutnya.']
};
const containments: Bilingual = {
    en: ['Lot {lot} on hold; 100% {inspect} of stock.', 'Suspect parts segregated, shipment blocked, 100% {inspect}.', 'Customer stock sorted; WIP quarantined pending {inspect}.'],
    id: ['Lot {lot} di-hold; {inspect} 100% stok.', 'Part suspect dipisah, pengiriman distop, {inspect} 100%.', 'Stok di customer disortir; WIP dikarantina sampai {inspect}.']
};
const severities: readonly Severity[] = ['Critical', 'Major', 'Major', 'Major', 'Minor', 'Minor'];

const pad = (n: number, width: number) => String(n).padStart(width, '0');
function addDays(date: string, days: number) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

const ncrs: SyntheticNcr[] = [];
const registry: EvidenceRecord[] = [];
// Each family gets 12 or 13 cases, in a shuffled order.
const familyOrder = shuffle(Array.from({ length: GENERATED }, (_, i) => families[i % families.length]));
familyOrder.forEach((family, i) => {
    const year = i < PER_YEAR ? 2023 : 2024;
    const seq = (i % PER_YEAR) + 1;
    const id = 'NCR-' + year + '-' + pad(seq, 3);
    const language = rng() < 0.5 ? 'en' : 'id';
    const info = areaInfo[family.area];
    const lot = 'LOT-' + info.lot + '-' + String(year).slice(2) + pad(between(1, 99), 2);
    const total = pick([120, 160, 200, 240, 320, 400, 480]);
    const quantity = between(2, Math.round(total / 6));
    const machine = pick(info.machines);
    const inspect = pick(info.inspect[language]);
    const parts = [
        pick((rng() < GENERIC_SYMPTOM_RATE ? info.genericSymptom : family.symptom)[language]) + '.',
        language === 'en' ? quantity + '/' + total + ' pcs NG, lot ' + lot + ', ' + machine + '.' : quantity + '/' + total + ' pcs NG di lot ' + lot + ', ' + machine + '.',
        rng() < CUE_RATE ? pick(family.cue[language]) : '',
        pick(reporters[language])
    ];
    const closedDate = addDays(year + '-01-15', between(0, 330));
    const evidenceIds = family.evidence.map(([prefix]) => prefix + '-' + String(year).slice(2) + pad(seq, 3));
    family.evidence.forEach(([, kind, summary], k) => registry.push({ id: evidenceIds[k], ncrId: id, kind, summary: summary + ' for ' + lot + '.', date: addDays(closedDate, -between(3, 25)) }));
    ncrs.push({
        id,
        title: pick((rng() < GENERIC_TITLE_RATE ? info.genericTitle : family.title)[language]),
        description: parts.filter(Boolean).join(' '),
        area: family.area,
        defectCode: family.defectCode,
        category: family.category,
        severity: pick(severities),
        lot,
        quantity,
        containment: pick(containments[language]).replace('{lot}', lot).replace('{inspect}', inspect),
        confirmedRootCause: family.rootCause,
        rootCauseCode: family.code,
        correctiveAction: family.action,
        evidenceIds,
        closedDate,
        language
    });
});
const dir = join(process.cwd(), 'data');
const anchors = JSON.parse(readFileSync(join(dir, 'anchor-history.json'), 'utf8')) as AnchorFile;
const anchorIds = new Set(anchors.ncrs.map(n => n.id));
ncrs.push(...anchors.ncrs);
registry.push(...anchors.evidence);
ncrs.sort((a, b) => a.id.localeCompare(b.id));
registry.sort((a, b) => a.id.localeCompare(b.id));

// Stratified hold-out: one case per root cause family, the rest drawn at random. Anchors always stay in the corpus.
const shuffled = shuffle(ncrs.filter(n => !anchorIds.has(n.id)));
const firstPerFamily = families.map(f => shuffled.find(n => n.rootCauseCode === f.code)!);
const heldOut = [...firstPerFamily, ...shuffled.filter(n => !firstPerFamily.includes(n))].slice(0, EVAL_SIZE);
const evalSet: EvalCase[] = heldOut.sort((a, b) => a.id.localeCompare(b.id)).map(n => ({
    id: n.id,
    query: n.title + '. ' + n.description,
    area: n.area,
    knownRootCauseCode: n.rootCauseCode,
    knownRootCause: n.confirmedRootCause
}));

mkdirSync(dir, { recursive: true });
const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
write('synthetic-ncrs.json', ncrs);
write('evidence-registry.json', registry);
write('eval-set.json', evalSet);
console.log('seed ' + SEED + ': ' + ncrs.length + ' NCRs (' + anchors.ncrs.length + ' anchors), ' + registry.length + ' evidence records, ' + evalSet.length + ' eval cases held out');
